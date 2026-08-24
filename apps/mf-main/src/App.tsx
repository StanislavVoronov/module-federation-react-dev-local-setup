import { Navigate, NavLink, useRoutes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { MfRemoteHardcoded } from './remotes/MfRemoteHardcoded';
import { RemoteModule } from './remotes/RemoteModule';
import { fetchRemotes } from './remotes/registry';
import type { RemoteDescriptor } from './remotes/registry';
import './index.css';

const MF_REMOTE_1: RemoteDescriptor = {
  name: 'mf_remote_1',
  entry: '/mf-remote-1/mf-manifest.json',
  module: 'Widget',
  title: 'mf-remote-1',
};

function DynamicWeather() {
  const [remote, setRemote] = useState<RemoteDescriptor | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    void fetchRemotes()
      .then((remotes) => {
        const weather = remotes.find(({ name }) => name === 'mf_remote_2');

        if (!weather) {
          throw new Error('mf_remote_2 отсутствует в /api/remotes');
        }

        if (active) {
          setRemote(weather);
        }
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error ? nextError : new Error(String(nextError)),
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <p className="host__status">{error.message}</p>;
  }

  if (!remote) {
    return <p className="host__status">Загружаю Weather…</p>;
  }

  return <RemoteModule remote={remote} />;
}

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
      element: <DynamicWeather />,
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
