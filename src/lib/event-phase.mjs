export function malaysiaTime(value) {
  let time = String(value).trim().replace(' ', 'T');
  if (/T\d\d:\d\d$/.test(time)) time += ':00';
  if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(time)) time += '+08:00';
  return Date.parse(time);
}

export function eventPhase(event, now = Date.now()) {
  const opening = malaysiaTime(event.mula);
  const racing = malaysiaTime(event.mulaRace || event.mula);
  const finish = malaysiaTime(event.tamatRace || event.tamat);
  const phase = now < opening ? 'sebelum' : now < racing ? 'menanti' : now < finish ? 'berlangsung' : 'selepas';
  return {
    phase,
    countdown: phase === 'sebelum' || phase === 'menanti',
    remaining: Math.max(0, (phase === 'sebelum' ? opening : racing) - now),
    headline: phase === 'menanti' ? 'THE RACE IS ALMOST HERE' : phase === 'berlangsung' ? 'IT’S RACE TIME!' : phase === 'selepas' ? 'THAT’S A WRAP!' : '',
  };
}
