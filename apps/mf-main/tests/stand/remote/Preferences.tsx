import { useState } from 'react';
import './Panels.css';

export default function Preferences() {
  const [name, setName] = useState('Гость');
  const [notifications, setNotifications] = useState(true);
  const [saved, setSaved] = useState(false);
  return (
    <section className="remote-panel remote-panel--rose" aria-label="Настройки">
      <h3>Настройки профиля</h3>
      <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }} onChange={() => setSaved(false)}>
        <label>Ваше имя<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="remote-check"><input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} />Получать уведомления</label>
        <button>Применить</button>
      </form>
      {saved && <p role="status">{name}, настройки применены для текущего просмотра. Уведомления {notifications ? 'включены' : 'выключены'}.</p>}
    </section>
  );
}
