import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
export function storage(env) {
  const client = new S3Client({
    region: env.AWS_REGION,
    maxAttempts: 2,
    ...(env.S3_ENDPOINT
      ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  })
  const Bucket = env.S3_BUCKET
  return {
    async put(Key, body) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: body,
          ContentType: 'text/html; charset=utf-8',
          ServerSideEncryption: 'AES256',
        }),
      )
    },
    async putImage(Key, body, ContentType) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: body,
          ContentType,
          ServerSideEncryption: 'AES256',
        }),
      )
    },
    async copy(sourceKey, Key, ContentType) {
      await client.send(
        new CopyObjectCommand({
          Bucket,
          Key,
          CopySource: `${Bucket}/${encodeURIComponent(sourceKey).replaceAll('%2F', '/')}`,
          ContentType,
          MetadataDirective: 'REPLACE',
          ServerSideEncryption: 'AES256',
        }),
      )
    },
    async get(Key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key }))
      return r.Body.transformToString()
    },
    async getBytes(Key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key }))
      return Buffer.from(await r.Body.transformToByteArray())
    },
    async remove(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }))
    },
    async deletePrefix(Prefix) {
      // Restart listing from the first remaining object after each deletion; safe after crashes.
      for (;;) {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix,
            MaxKeys: 1000,
          }),
        )
        if (!page.Contents?.length) return
        const r = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: {
              Objects: page.Contents.map((o) => ({ Key: o.Key })),
              Quiet: true,
            },
          }),
        )
        if (r.Errors?.length) throw new Error('STORAGE_DELETE_FAILED')
      }
    },
    async deleteUser(user) {
      return this.deletePrefix(`users/${user}/`)
    },
  }
}
