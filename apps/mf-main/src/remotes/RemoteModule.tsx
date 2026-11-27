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

/** Рендерит произвольный remote-модуль по его описанию. */
export function RemoteModule({ remote }: { remote: RemoteDescriptor }) {
  return (
    <DynamicModule
      fallbacks={{ error: DefaultRemoteError }}
      source={{
        hostId: import.meta.env.PUBLIC_FRONT_MODULE_ID,
        hostName: import.meta.env.PUBLIC_FRONT_MODULE_NAME,
        remoteId: remote.name,
        remoteName: remote.title ?? `${remote.name}/${remote.module}`,
        enabled: true,
        publicPath: remote.path,
        manifest: remote.manifest,
        componentName: remote.module,
      }}
    />
  );
}
