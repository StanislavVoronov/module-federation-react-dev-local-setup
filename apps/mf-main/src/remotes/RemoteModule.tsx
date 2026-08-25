import {
  registerRemotes,
  loadRemote,
} from '@module-federation/enhanced/runtime';
import { lazy, Suspense, useState } from 'react';
import type { ComponentType } from 'react';
import { RemoteBoundary } from '../RemoteBoundary';

/**
 * Описание одного remote: что грузить и как подписать.
 *
 * Контейнеры перечислены здесь же, в коде: реального выбора в рантайме нет,
 * маршруты заданы явно. Регистрация — рантаймовая (`registerRemotes` ниже),
 * а build-time декларация тех же контейнеров лежит в конфиге оболочки и нужна
 * ради HMR — см. `remotes` в apps/mf-host/rsbuild.config.ts.
 */
export type RemoteDescriptor = {
  /** Имя контейнера, совпадает с `name` в конфиге remote. */
  name: string;
  /** Относительный путь до манифеста, проксируется на dev-сервер remote. */
  entry: string;
  /** Ключ из `exposes` без ведущего './'. */
  module: string;
  /** Подпись для UI. */
  title?: string;
};

async function loadRemoteComponent(remote: RemoteDescriptor) {
  registerRemotes([{ name: remote.name, entry: remote.entry }]);

  const moduleId = `${remote.name}/${remote.module}`;
  const loaded = await loadRemote<{ default: ComponentType }>(moduleId);

  if (!loaded) {
    throw new Error(`${moduleId} не найден в ${remote.entry}`);
  }

  return loaded;
}

/** Рендерит произвольный remote-модуль по его описанию. */
export function RemoteModule({ remote }: { remote: RemoteDescriptor }) {
  const label = remote.title ?? `${remote.name}/${remote.module}`;

  // Ленивый инициализатор useState, а не голый const: тот пересоздавал бы
  // lazy-компонент на каждом рендере, и remote перемонтировался бы,
  // теряя своё состояние.
  const [Component] = useState(() => lazy(() => loadRemoteComponent(remote)));

  return (
    <RemoteBoundary name={label}>
      <Suspense fallback={<p className="host__status">Загружаю {label}…</p>}>
        <Component />
      </Suspense>
    </RemoteBoundary>
  );
}
