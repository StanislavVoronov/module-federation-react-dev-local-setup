import { Navigate, NavLink, useRoutes } from 'react-router-dom';
import { MfRemoteHardcoded } from './remotes/MfRemoteHardcoded';
import { RemoteModule } from './remotes/RemoteModule';
import type { RemoteDescriptor } from './remotes/RemoteModule';
import './index.css';

const MF_REMOTE_1: RemoteDescriptor = {
  name: 'mf_remote_1',
  entry: '/mf-remote-1/mf-manifest.json',
  module: 'Widget',
  title: 'mf-remote-1',
};

const MF_REMOTE_2: RemoteDescriptor = {
  name: 'mf_remote_2',
  entry: '/mf-remote-2/mf-manifest.json',
  module: 'Weather',
  title: 'Погода',
};

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'host__nav-link host__nav-link--active'
    : 'host__nav-link';
}

export function App() {
  const routes = useRoutes([
    {
      path: '/',
      element: <Navigate to="/mf-remote" replace />,
    },
    {
      path: '/hardcoded',
      element: <Navigate to="/mf-remote" replace />,
    },
    {
      path: '/mf-remote',
      element: <MfRemoteHardcoded />,
    },
    {
      path: '/mf-remote-1',
      element: <RemoteModule remote={MF_REMOTE_1} />,
    },
    {
      path: '/weather',
      element: <RemoteModule remote={MF_REMOTE_2} />,
    },
  ]);

  return (
    <main className="host">
      <nav className="host__nav">
        <NavLink className={navLinkClassName} to="/mf-remote">
          mf-remote
        </NavLink>
        <NavLink className={navLinkClassName} to="/mf-remote-1">
          mf-remote-1
        </NavLink>
        <NavLink className={navLinkClassName} to="/weather">
          Weather
        </NavLink>
      </nav>

      {routes}
    </main>
  );
}

export default App;
