import { useState } from 'react';
import './Panels.css';

export default function Tasks() {
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  return (
    <section className="remote-panel remote-panel--green" aria-label="Задачи">
      <h3>Задачи на сегодня</h3>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        setTasks((items) => [...items, { id: crypto.randomUUID(), title: text.trim(), done: false }]);
        setText('');
      }}>
        <label>Новая задача<input value={text} onChange={(event) => setText(event.target.value)} /></label>
        <button disabled={!text.trim()}>Добавить</button>
      </form>
      <ul>{tasks.map((task) => (
        <li key={task.id}>
          <label className="remote-check">
            <input type="checkbox" checked={task.done} onChange={() => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))} />
            <span style={{ textDecoration: task.done ? 'line-through' : undefined }}>{task.title}</span>
          </label>
          <button aria-label={`Удалить ${task.title}`} onClick={() => setTasks((items) => items.filter((item) => item.id !== task.id))}>Удалить</button>
        </li>
      ))}</ul>
      <p>Выполнено {tasks.filter((task) => task.done).length} из {tasks.length}</p>
    </section>
  );
}
