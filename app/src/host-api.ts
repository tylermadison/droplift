// The page's view of the Host API. In the app it calls `tiny.api.call`; tests pass a fake.
import type { DestinationDraft, DestinationSummary, LinkChoice, TestResult } from '../backend/destinations'

export type { DestinationDraft, DestinationSummary, LinkChoice, TestResult }

export interface AwsProfile {
  name: string
  region: string
  sso: boolean
}

export interface HostApi {
  listDestinations(): Promise<DestinationSummary[]>
  testDestination(draft: DestinationDraft): Promise<TestResult>
  saveDestination(draft: DestinationDraft): Promise<void>
  awsProfiles(): Promise<AwsProfile[]>
}

export const tinyHost: HostApi = {
  listDestinations: () => tiny.api.call('listDestinations'),
  testDestination: (draft) => tiny.api.call('testDestination', draft),
  saveDestination: (draft) => tiny.api.call('saveDestination', draft),
  awsProfiles: () => tiny.api.call('awsProfiles'),
}
