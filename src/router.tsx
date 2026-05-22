import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"
import { AppShell } from "./components/layout/AppShell"
import { loadActiveProjectId } from "./lib/projects"

const rootRoute = createRootRoute({
  component: () => (
    <>
      <AppShell />
      <Outlet />
    </>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: () => <Outlet />,
})

const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: () => null,
})

const terminalRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "terminals/$terminalId",
  component: () => null,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectRoute.addChildren([projectIndexRoute, terminalRoute]),
])

function initialPath(): string {
  const id = loadActiveProjectId()
  return id ? `/projects/${id}` : "/"
}

export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: [initialPath()] }),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
