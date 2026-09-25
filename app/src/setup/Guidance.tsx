// Setup help: the minimum IAM policy (PRD A2) and the lifecycle rule (PRD U11).
// s3:DeleteObject is not in PRD A2, but Test deletes its test object, so the policy needs it.

function iamPolicy(bucket: string) {
  const arn = `arn:aws:s3:::${bucket || 'BUCKET'}`
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:DeleteObject', 's3:GetObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
        Resource: `${arn}/*`,
      },
      { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: arn },
      { Effect: 'Allow', Action: ['cloudwatch:GetMetricData'], Resource: '*' },
    ],
  }
}

export function Guidance({ bucket }: { bucket: string }) {
  return (
    <>
      <section aria-labelledby="iam-policy">
        <h2 id="iam-policy">Minimum IAM policy</h2>
        <pre>{JSON.stringify(iamPolicy(bucket), null, 2)}</pre>
      </section>
      <p>
        Add a bucket lifecycle rule with <code>AbortIncompleteMultipartUpload</code> (for example, after 1 day), so
        failed uploads do not keep costing storage.
      </p>
    </>
  )
}
