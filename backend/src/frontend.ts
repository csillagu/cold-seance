import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { API_PREFIX } from './api/api.ts'
import { errorBody } from './api/errors.ts'

/**
 * The built frontend (DD-045), `frontend/dist/`. The path is the same from `backend/src/` and
 * from the built `backend/dist/`, so it holds in the repository and in the Docker image (SC-028),
 * which keeps the two packages side by side.
 */
export const defaultFrontendDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url))

/** The built frontend's own page, which the single-page application starts from. */
const indexFile = 'index.html'

/** Whether `dir` holds a built frontend. */
export function hasFrontend(dir: string): boolean {
  return existsSync(join(dir, indexFile))
}

/**
 * Serves the built frontend from `dir` (SC-028): the backend, the one process in the image,
 * serves it (DD-040). Its files are served as they are; any other GET or HEAD
 * outside the REST API is answered with its `index.html`, since the frontend is a single-page
 * application whose own routes are not files; a missing file is not found. The REST API keeps its own answers: nothing under
 * `API_PREFIX` reaches the frontend. Anything else not found is a 404 in the API's error shape.
 */
export function serveFrontend(app: FastifyInstance, dir: string): void {
  // One route per file found at start, not a wildcard route, which would also catch unknown
  // routes under the REST API and answer them before the API's authentication.
  void app.register(fastifyStatic, { root: dir, wildcard: false })

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?', 1)[0]!
    const underApi = path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)
    // A missing file, such as a script of an older build that a browser still asks for, is a 404:
    // index.html in its place would fail in the browser as a script of the wrong type.
    const isFile = /\.[^/]*$/.test(path)
    if ((request.method === 'GET' || request.method === 'HEAD') && !underApi && !isFile) {
      return reply.sendFile(indexFile)
    }
    return reply.code(404).send(errorBody(404, 'Not Found'))
  })
}
