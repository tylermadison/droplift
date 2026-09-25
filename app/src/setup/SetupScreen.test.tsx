import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { DestinationDraft, HostApi } from '../host-api'
import { SetupScreen } from './SetupScreen'

function fakeHost(overrides: Partial<HostApi> = {}): HostApi {
  return {
    listDestinations: async () => [],
    testDestination: async () => ({ ok: true }),
    saveDestination: async () => {},
    awsProfiles: async () => [],
    ...overrides,
  }
}

describe('SetupScreen', () => {
  test('shows the empty state when there are no destinations', async () => {
    render(<SetupScreen host={fakeHost()} />)

    expect(await screen.findByRole('heading', { name: 'Connect your first destination' })).toBeInTheDocument()
  })

  test('R2: Save is enabled only after Test passes', async () => {
    const tested: DestinationDraft[] = []
    render(<SetupScreen host={fakeHost({ testDestination: async (d) => (tested.push(d), { ok: true }) })} />)
    const user = userEvent.setup()

    await fillR2Form(user)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled()
    expect(tested).toEqual([
      {
        provider: 'r2',
        name: 'personal',
        bucket: 'public-assets',
        accountId: '0123456789abcdef0123456789abcdef',
        credentials: { kind: 'keys', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG' },
      },
    ])
  })
})

describe('SetupScreen S3', () => {
  test('S3 can use a named AWS profile, and SSO profiles are marked', async () => {
    const tested: DestinationDraft[] = []
    const host = fakeHost({
      awsProfiles: async () => [
        { name: 'work', region: 'us-west-2', sso: false },
        { name: 'sso-dev', region: 'eu-west-1', sso: true },
      ],
      testDestination: async (d) => (tested.push(d), { ok: true }),
    })
    render(<SetupScreen host={host} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: 'Amazon S3' }))
    await user.click(screen.getByRole('radio', { name: 'AWS profile' }))
    await user.selectOptions(screen.getByLabelText('Profile'), await screen.findByRole('option', { name: 'sso-dev (SSO)' }))
    await user.type(screen.getByLabelText('Name'), 'work')
    await user.type(screen.getByLabelText('Bucket'), 'build-artifacts')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(tested).toEqual([
      { provider: 's3', name: 'work', bucket: 'build-artifacts', credentials: { kind: 'profile', profile: 'sso-dev' } },
    ])
  })
})

describe('SetupScreen public URL', () => {
  test('an optional public base URL goes into the draft', async () => {
    const tested: DestinationDraft[] = []
    render(<SetupScreen host={fakeHost({ testDestination: async (d) => (tested.push(d), { ok: true }) })} />)
    const user = userEvent.setup()

    await fillR2Form(user)
    await user.type(screen.getByLabelText('Public base URL (optional)'), 'https://cdn.example.com')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(tested[0]).toEqual(expect.objectContaining({ publicBaseUrl: 'https://cdn.example.com' }))
  })
})

describe('SetupScreen guidance', () => {
  test('shows the minimum IAM policy, including the delete that Test needs', async () => {
    render(<SetupScreen host={fakeHost()} />)

    const policy = await screen.findByRole('region', { name: 'Minimum IAM policy' })
    for (const action of [
      's3:PutObject',
      's3:DeleteObject',
      's3:AbortMultipartUpload',
      's3:ListBucket',
      's3:ListMultipartUploadParts',
      's3:GetObject',
      'cloudwatch:GetMetricData',
    ]) {
      expect(policy).toHaveTextContent(action)
    }
  })

  test('recommends the lifecycle rule that aborts incomplete multipart uploads', async () => {
    render(<SetupScreen host={fakeHost()} />)

    expect(await screen.findByText(/AbortIncompleteMultipartUpload/)).toBeInTheDocument()
  })
})

describe('SetupScreen save', () => {
  test('Save saves the tested destination, then shows the Dock tip', async () => {
    const saved: DestinationDraft[] = []
    render(<SetupScreen host={fakeHost({ saveDestination: async (d) => void saved.push(d) })} />)
    const user = userEvent.setup()

    await fillR2Form(user)
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Drag files onto the Droplift icon in your Dock to upload.')).toBeInTheDocument()
    expect(saved).toEqual([expect.objectContaining({ provider: 'r2', name: 'personal', bucket: 'public-assets' })])
  })
})

describe('SetupScreen failures', () => {
  test('a failed Test shows its message, and Save stays disabled', async () => {
    const message = 'personal cannot write to public-assets.'
    render(<SetupScreen host={fakeHost({ testDestination: async () => ({ ok: false, message }) })} />)
    const user = userEvent.setup()

    await fillR2Form(user)
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

async function fillR2Form(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: 'Cloudflare R2' }))
  await user.type(screen.getByLabelText('Name'), 'personal')
  await user.type(screen.getByLabelText('Account ID'), '0123456789abcdef0123456789abcdef')
  await user.type(screen.getByLabelText('Bucket'), 'public-assets')
  await user.type(screen.getByLabelText('Access key ID'), 'AKIDEXAMPLE')
  await user.type(screen.getByLabelText('Secret access key'), 'wJalrXUtnFEMI/K7MDENG')
}
