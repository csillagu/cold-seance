import { Route, Routes } from 'react-router'
import { Layout } from './layout/Layout.tsx'
import { AccountsPage } from './pages/AccountsPage.tsx'
import { GanttPage } from './pages/GanttPage.tsx'
import { GitHubLinkPage } from './pages/GitHubLinkPage.tsx'
import { KanbanPage } from './pages/KanbanPage.tsx'
import { PersonLoadPage } from './pages/PersonLoadPage.tsx'
import { ProjectPage } from './pages/ProjectPage.tsx'
import { ProposalPage } from './pages/ProposalPage.tsx'
import { ProposalsPage } from './pages/ProposalsPage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'
import { StartPage } from './pages/StartPage.tsx'
import { TaskPage } from './pages/TaskPage.tsx'
import { TokensPage } from './pages/TokensPage.tsx'
import { UnknownPage } from './pages/UnknownPage.tsx'
import { SIGN_IN_PATH } from './sign-in-redirect.ts'

/**
 * The frontend's pages and their addresses. The sign-in page is outside the layout (SRC-223);
 * every other page is inside it (SC-113), and the navigation leads to each (SRC-222). A page
 * added here, in its alphabetical place, needs a way to it in the navigation too.
 */
export function App() {
  return (
    <Routes>
      <Route path={SIGN_IN_PATH} element={<SignInPage />} />
      <Route element={<Layout />}>
        <Route index element={<StartPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="accounts/:accountId/github" element={<GitHubLinkPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />}>
          <Route path="gantt" element={<GanttPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="load" element={<PersonLoadPage />} />
          <Route path="proposals" element={<ProposalsPage />} />
        </Route>
        <Route path="proposals/:proposalId" element={<ProposalPage />} />
        <Route path="settings/github" element={<GitHubLinkPage key="own" />} />
        <Route path="tasks/:taskId" element={<TaskPage />} />
        <Route path="tokens" element={<TokensPage />} />
        <Route path="*" element={<UnknownPage />} />
      </Route>
    </Routes>
  )
}
