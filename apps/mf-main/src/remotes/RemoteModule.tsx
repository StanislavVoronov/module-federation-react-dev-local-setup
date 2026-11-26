import { DefaultRemoteError, DynamicModule } from './DynamicModule';

/**
 * Описание одного remote: что грузить и как подписать.
 *
 * Содержит адрес регистрации, ключ exposed-модуля и подпись для маршрута.
 */
export type RemoteDescriptor = {
  /** Имя контейнера, совпадает с `name` в конфиге remote. */
  name: string;
  /** Базовый путь контейнера, проксируется на dev-сервер remote. */
  path: string;
  /** Имя файла манифеста относительно базового пути. */
  manifest?: string;
  /** Ключ из `exposes` без ведущего './'. */
  module: string;
  /** Подпись для UI. */
  title?: string;
};

const HOST = { id: 'mf_main', name: 'mf-main' };

/** Рендерит произвольный remote-модуль по его описанию. */
export function RemoteModule({ remote }: { remote: RemoteDescriptor }) {
  return (
    <DynamicModule
      host={HOST}
      fallbacks={{ error: DefaultRemoteError }}
      remote={{
        id: remote.name,
        name: remote.title ?? `${remote.name}/${remote.module}`,
        enabled: true,
        path: remote.path,
        manifest: remote.manifest,
        component: remote.module,
      }}
    />
  );
}
