import type { FastifyPluginAsync } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

/**
 * The route that exports a project's Gantt as a Mermaid gantt chart (SC-021, SC-026). It only
 * translates the request; the exporter decides what the chart holds and who may have it (DD-039).
 */
export const ganttExportRoutes: FastifyPluginAsync<RouteGroupOptions> = async (
  group,
  { services },
) => {
  group.get<{ Params: { projectId: string } }>(
    '/:projectId/gantt/mermaid',
    {
      schema: {
        description:
          "The project's Gantt as a Mermaid gantt chart that renders in GitHub markdown: each " +
          'task with its planned start and finish, each milestone on its day, and the tasks each ' +
          'depends on, but no load or red flags. Tasks that lie on no date are left out.',
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['markdown'],
            properties: {
              markdown: {
                type: 'string',
                description:
                  'The chart in a fenced `mermaid` code block, to paste into GitHub markdown as ' +
                  'it is',
              },
            },
          },
        },
      },
    },
    async (request) =>
      services.ganttExport.exportProjectGantt(callerOf(request), request.params.projectId),
  )
}
