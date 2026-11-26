import { useState } from 'react';
import './Panels.css';

export default function Calculator() {
  const [price, setPrice] = useState('1000');
  const [discount, setDiscount] = useState('10');
  const valid = price !== '' && discount !== '' && Number(price) >= 0 && Number(discount) >= 0 && Number(discount) <= 100;
  return (
    <section className="remote-panel remote-panel--orange" aria-label="Калькулятор">
      <h3>Калькулятор скидки</h3>
      <label>Цена, ₽<input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      <label>Скидка, %<input type="number" min="0" max="100" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
      {valid ? <p>К оплате <output aria-label="К оплате">{(Number(price) * (1 - Number(discount) / 100)).toFixed(2)} ₽</output></p> : <p role="alert">Укажите цену от 0 и скидку от 0 до 100%.</p>}
    </section>
  );
}
