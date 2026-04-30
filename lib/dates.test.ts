import { describe, it, expect } from 'vitest';
import { addBusinessDays, nextPublicationSlot, fmtDate } from './dates';

// Helper : date fixe pour reproductibilité. Lundi 1er juin 2026.
const monday = new Date('2026-06-01T12:00:00Z');
const tuesday = new Date('2026-06-02T12:00:00Z');
const friday = new Date('2026-06-05T12:00:00Z');
const saturday = new Date('2026-06-06T12:00:00Z');

describe('addBusinessDays', () => {
  it('+1 jour ouvré sur un lundi → mardi', () => {
    const out = addBusinessDays(monday, 1);
    expect(out.getDay()).toBe(2); // tuesday
  });

  it('+1 jour ouvré sur un vendredi → lundi suivant', () => {
    const out = addBusinessDays(friday, 1);
    expect(out.getDay()).toBe(1); // monday
  });

  it('+5 jours ouvrés sur un lundi → lundi suivant', () => {
    const out = addBusinessDays(monday, 5);
    expect(out.getDay()).toBe(1); // monday
    // Une semaine plus tard
    const diff = (out.getTime() - monday.getTime()) / 86_400_000;
    expect(diff).toBe(7);
  });

  it('+0 jour → la date elle-même (pas de modif)', () => {
    const out = addBusinessDays(monday, 0);
    expect(out.getTime()).toBe(monday.getTime());
  });

  it('+2 jours ouvrés sur un vendredi → mardi suivant', () => {
    const out = addBusinessDays(friday, 2);
    expect(out.getDay()).toBe(2); // tuesday
  });

  it('+1 jour ouvré sur un samedi → lundi suivant (skip dimanche)', () => {
    const out = addBusinessDays(saturday, 1);
    expect(out.getDay()).toBe(1); // monday
  });

  it('ne mute pas la date d\'origine', () => {
    const before = monday.getTime();
    addBusinessDays(monday, 5);
    expect(monday.getTime()).toBe(before);
  });
});

describe('nextPublicationSlot', () => {
  it('depuis un lundi → mardi (lendemain)', () => {
    const out = nextPublicationSlot(monday);
    expect(out.getDay()).toBe(2); // tuesday
  });

  it('depuis un mardi → jeudi (skip mer + le mardi courant)', () => {
    const out = nextPublicationSlot(tuesday);
    expect(out.getDay()).toBe(4); // thursday
  });

  it('depuis un vendredi → mardi suivant', () => {
    const out = nextPublicationSlot(friday);
    expect(out.getDay()).toBe(2); // tuesday
  });

  it('renvoie toujours soit mardi (2) soit jeudi (4)', () => {
    for (let day = 0; day <= 6; day++) {
      const start = new Date('2026-06-01T12:00:00Z');
      start.setDate(start.getDate() + day);
      const out = nextPublicationSlot(start);
      expect([2, 4]).toContain(out.getDay());
    }
  });

  it('ne mute pas la date d\'origine', () => {
    const before = monday.getTime();
    nextPublicationSlot(monday);
    expect(monday.getTime()).toBe(before);
  });
});

describe('fmtDate', () => {
  it('renvoie un format français lisible', () => {
    const out = fmtDate(new Date('2026-06-01T12:00:00Z'));
    // Format attendu : "lundi 1 juin"
    expect(out).toMatch(/lundi/i);
    expect(out).toMatch(/juin/i);
  });

  it('inclut le weekday + day + month sans année', () => {
    const out = fmtDate(new Date('2026-12-25T12:00:00Z'));
    expect(out).toMatch(/vendredi/i);
    expect(out).toMatch(/25/);
    expect(out).toMatch(/décembre/i);
  });
});
