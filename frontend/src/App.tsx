import { Route, Routes } from 'react-router'
import { Layout } from './layout/Layout.tsx'
import { AccountsPage } from './pages/AccountsPage.tsx'
import { AuditLogPage } from './pages/AuditLogPage.tsx'
import { CalendarPage } from './pages/CalendarPage.tsx'
import { CapacityPage } from './pages/CapacityPage.tsx'
import { CompanyCalendarPage } from './pages/CompanyCalendarPage.tsx'
import { GanttPage } from './pages/GanttPage.tsx'
import { GitHubLinkPage } from './pages/GitHubLinkPage.tsx'
import { KanbanPage } from './pages/KanbanPage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { NewProjectPage } from './pages/NewProjectPage.tsx'
import { NewTaskPage } from './pages/NewTaskPage.tsx'
import { NotificationsPage } from './pages/NotificationsPage.tsx'
import { PersonLoadPage } from './pages/PersonLoadPage.tsx'
import { ProjectAuditLogPage } from './pages/ProjectAuditLogPage.tsx'
import { ProjectPage } from './pages/ProjectPage.tsx'
import { ProjectRepositoriesPage } from './pages/ProjectRepositoriesPage.tsx'
import { ProjectSavedViewsPage } from './pages/ProjectSavedViewsPage.tsx'
import { ProposalPage } from './pages/ProposalPage.tsx'
import { ProposalsPage } from './pages/ProposalsPage.tsx'
import { RepositoriesPage } from './pages/RepositoriesPage.tsx'
import { RepositoryPage } from './pages/RepositoryPage.tsx'
import { RepositoryRequestsPage } from './pages/RepositoryRequestsPage.tsx'
import { SavedViewEditorPage } from './pages/SavedViewEditorPage.tsx'
import { SavedViewPage } from './pages/SavedViewPage.tsx'
import { SavedViewsPage } from './pages/SavedViewsPage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'
import { StartPage } from './pages/StartPage.tsx'
import { TaskPage } from './pages/TaskPage.tsx'
import { TokensPage } from './pages/TokensPage.tsx'
import { UnknownPage } from './pages/UnknownPage.tsx'
import { VariancePage } from './pages/VariancePage.tsx'
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
        <Route path="accounts/:accountId/calendar" element={<CalendarPage />} />
        <Route path="accounts/:accountId/capacity" element={<CapacityPage />} />
        <Route path="accounts/:accountId/github" element={<GitHubLinkPage />} />
        <Route path="audit-log" element={<AuditLogPage />} />
        <Route path="company-calendar" element={<CompanyCalendarPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="projects/new" element={<NewProjectPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />}>
          <Route path="audit-log" element={<ProjectAuditLogPage />} />
          <Route path="gantt" element={<GanttPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="load" element={<PersonLoadPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="proposals" element={<ProposalsPage />} />
          <Route path="repositories" element={<ProjectRepositoriesPage />} />
          <Route path="tasks/new" element={<NewTaskPage />} />
          <Route path="variance" element={<VariancePage />} />
          <Route path="views" element={<ProjectSavedViewsPage />} />
        </Route>
        <Route path="proposals/:proposalId" element={<ProposalPage />} />
        <Route path="repositories" element={<RepositoriesPage />} />
        <Route path="repositories/:repositoryId" element={<RepositoryPage />} />
        <Route path="repository-requests" element={<RepositoryRequestsPage />} />
        <Route path="settings/calendar" element={<CalendarPage key="own" />} />
        <Route path="settings/capacity" element={<CapacityPage key="own" />} />
        <Route path="settings/github" element={<GitHubLinkPage key="own" />} />
        <Route path="tasks/:taskId" element={<TaskPage />} />
        <Route path="tokens" element={<TokensPage />} />
        <Route path="views" element={<SavedViewsPage />} />
        <Route path="views/new" element={<SavedViewEditorPage />} />
        <Route path="views/:viewId" element={<SavedViewPage />} />
        <Route path="*" element={<UnknownPage />} />
      </Route>
    </Routes>
  )
}
