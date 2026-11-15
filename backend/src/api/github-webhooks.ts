import type { FastifyPluginAsync } from 'fastify'
import type { WebhookHeaders, WebhookVerdict } from '../github/webhooks.ts'
import { ServiceError } from '../service/errors.ts'
import type { RouteGroupOptions } from './api.ts'

/** What the webhook endpoint hands each delivery to: the GitHub webhook receiver (SC-105). */
export interface WebhookReceiver {
  receive(headers: WebhookHeaders, body: Buffer, payload: unknown): WebhookVerdict
}

/** A delivery's raw body, which its signature is computed over, kept beside the parsed one. */
const RAW_BODY = Symbol('raw body')

const REFUSALS: Record<Exclude<WebhookVerdict, 'accepted'>, string> = {
  'no-secret': 'No webhook secret is configured for the sender of this delivery',
  'bad-signature': 'The signature of this delivery does not match its webhook secret',
}

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * The GitHub webhook endpoint (SC-105, DD-044): `POST /api/github/webhooks`, where the webhooks
 * of the installation's GitHub Apps and of its repositories and organizations are pointed
 * (DD-058, DD-060). GitHub does not sign in, so the route is public; a delivery is accepted only
 * if its signature matches the secret configured for its sender, and is refused with 401
 * otherwise, without any effect. An accepted one is answered 202 at once and handed to the GitHub
 * change handler in the background. Deliveries are JSON, as GitHub sends them when a webhook's
 * content type is `application/json`.
 */
export const githubWebhookRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { webhooks },
) => {
  // The signature is over the bytes GitHub sent, so the body is kept as it came, beside the
  // parsed JSON; only in this group.
  group.removeContentTypeParser('application/json')
  group.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    try {
      const raw = Buffer.isBuffer(body) ? body : Buffer.from(body)
      Reflect.set(request, RAW_BODY, raw)
      done(null, JSON.parse(raw.toString('utf8')))
    } catch {
      done(new ServiceError('invalid', 'The body of this delivery is not valid JSON'), undefined)
    }
  })

  group.post(
    '/webhooks',
    {
      config: { public: true },
      schema: {
        description: 'Receives a webhook delivery from GitHub (SC-105).',
        body: { type: 'object' },
        response: {
          202: {
            type: 'object',
            properties: { accepted: { type: 'boolean', const: true } },
            required: ['accepted'],
          },
        },
      },
    },
    async (request, reply) => {
      if (webhooks === undefined)
        throw new Error('The REST API was built without a webhook receiver')
      const raw: unknown = Reflect.get(request, RAW_BODY)
      const verdict = webhooks.receive(
        {
          event: header(request.headers['x-github-event']),
          signature: header(request.headers['x-hub-signature-256']),
          targetType: header(request.headers['x-github-hook-installation-target-type']),
          targetId: header(request.headers['x-github-hook-installation-target-id']),
        },
        Buffer.isBuffer(raw) ? raw : Buffer.alloc(0),
        request.body,
      )
      if (verdict !== 'accepted') throw new ServiceError('unauthenticated', REFUSALS[verdict])
      return reply.code(202).send({ accepted: true })
    },
  )
}
