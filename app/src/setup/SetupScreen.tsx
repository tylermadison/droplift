import { useEffect, useState } from 'react'
import { Guidance } from './Guidance'
import type { AwsProfile, DestinationDraft, DestinationSummary, HostApi } from '../host-api'

type Provider = DestinationDraft['provider']
type CredentialKind = 'keys' | 'profile'

interface Fields {
  name: string
  bucket: string
  region: string
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  profile: string
  publicBaseUrl: string
}

const empty: Fields = { name: '', bucket: '', region: '', accountId: '', accessKeyId: '', secretAccessKey: '', profile: '', publicBaseUrl: '' }

function toDraft(provider: Provider, kind: CredentialKind, f: Fields): DestinationDraft {
  const useProfile = provider === 's3' && kind === 'profile'
  return {
    provider,
    name: f.name,
    bucket: f.bucket,
    ...(provider === 's3' && !useProfile && f.region && { region: f.region }),
    ...(provider === 'r2' && { accountId: f.accountId }),
    ...(f.publicBaseUrl && { publicBaseUrl: f.publicBaseUrl }),
    credentials: useProfile
      ? { kind: 'profile', profile: f.profile }
      : { kind: 'keys', accessKeyId: f.accessKeyId, secretAccessKey: f.secretAccessKey },
  }
}

export function SetupScreen({ host }: { host: HostApi }) {
  const [destinations, setDestinations] = useState<DestinationSummary[] | null>(null)
  const [profiles, setProfiles] = useState<AwsProfile[]>([])
  const [provider, setProvider] = useState<Provider>('s3')
  const [kind, setKind] = useState<CredentialKind>('keys')
  const [fields, setFields] = useState<Fields>(empty)
  // The draft that last passed Test. Save works only while the form still matches it.
  const [passed, setPassed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    host.listDestinations().then(setDestinations)
    host.awsProfiles().then(setProfiles)
  }, [host])

  const draft = toDraft(provider, kind, fields)
  const canSave = passed === JSON.stringify(draft)

  async function runTest() {
    const result = await host.testDestination(draft)
    setPassed(result.ok ? JSON.stringify(draft) : null)
    setError(result.ok ? null : result.message)
  }

  async function save() {
    await host.saveDestination(draft)
    setSaved(true)
  }

  const set = (key: keyof Fields) => (e: { target: { value: string } }) => setFields({ ...fields, [key]: e.target.value })
  const field = (key: keyof Fields, label: string, type = 'text') => (
    <label>
      {label}
      <input type={type} value={fields[key]} onChange={set(key)} />
    </label>
  )

  if (destinations === null) return null
  if (saved) return <p>Drag files onto the Droplift icon in your Dock to upload.</p>
  return (
    <main>
      {destinations.length === 0 && <h1>Connect your first destination</h1>}
      <fieldset>
        <legend>Provider</legend>
        <label>
          <input type="radio" name="provider" checked={provider === 's3'} onChange={() => setProvider('s3')} />
          Amazon S3
        </label>
        <label>
          <input type="radio" name="provider" checked={provider === 'r2'} onChange={() => setProvider('r2')} />
          Cloudflare R2
        </label>
      </fieldset>
      {field('name', 'Name')}
      {provider === 'r2' && field('accountId', 'Account ID')}
      {field('bucket', 'Bucket')}
      {provider === 's3' && (
        <fieldset>
          <legend>Credentials</legend>
          <label>
            <input type="radio" name="kind" checked={kind === 'keys'} onChange={() => setKind('keys')} />
            Access keys
          </label>
          <label>
            <input type="radio" name="kind" checked={kind === 'profile'} onChange={() => setKind('profile')} />
            AWS profile
          </label>
        </fieldset>
      )}
      {provider === 's3' && kind === 'profile' ? (
        <label>
          Profile
          <select value={fields.profile} onChange={set('profile')}>
            <option value="">Select a profile</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.sso ? `${p.name} (SSO)` : p.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          {provider === 's3' && field('region', 'Region')}
          {field('accessKeyId', 'Access key ID')}
          {field('secretAccessKey', 'Secret access key', 'password')}
        </>
      )}
      {field('publicBaseUrl', 'Public base URL (optional)', 'url')}
      <button type="button" onClick={runTest}>
        Test
      </button>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={!canSave} onClick={save}>
        Save
      </button>
      <Guidance bucket={fields.bucket} />
    </main>
  )
}
