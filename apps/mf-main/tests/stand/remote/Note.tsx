import { useState } from 'react';
import './Note.css';

export default function Note({ title = 'Заметка' }: { title?: string }) {
  const [note, setNote] = useState('');

  return (
    <section className="stand-note" aria-label={title}>
      <h3>{title}</h3>
      <p>Запишите короткую мысль или идею.</p>
      <label>
        Текст заметки
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Например, идея для встречи"
        />
      </label>
    </section>
  );
}
