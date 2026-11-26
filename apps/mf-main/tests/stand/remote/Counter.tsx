import { useState } from 'react';
import './Panels.css';

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <section className="remote-panel remote-panel--blue" aria-label="Счётчик">
      <h3>Счётчик</h3>
      <p>Отмечайте выполненные подходы или повторения.</p>
      <output aria-label="Значение счётчика">{count}</output>
      <div className="remote-actions">
        <button onClick={() => setCount((value) => value - 1)}>Уменьшить</button>
        <button onClick={() => setCount((value) => value + 1)}>Увеличить</button>
        <button onClick={() => setCount(0)}>Сбросить</button>
      </div>
    </section>
  );
}
