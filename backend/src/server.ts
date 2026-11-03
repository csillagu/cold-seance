import { buildApp } from './app.ts'

// The listen address is not a setting named so far (DD-059); the configuration loader (SC-109)
// decides where it comes from. Until then the development server listens on localhost:3000.
const app = buildApp({ logger: true })
await app.listen({ host: '127.0.0.1', port: 3000 })
