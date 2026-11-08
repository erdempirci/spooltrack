import { describe, expect, it } from 'vitest';
import { densityFor, parsePipeSection, pipeKg, pipeKgPerMetre } from './pipeWeight';

const pipe = (size: string, grade = 'P235GH', unit = 'mm', spec = '') => ({ description: 'PIPE SEAMLESS', size, grade, unit, spec });

describe('pipe weight', () => {
  it('reads OD x wall in several writings', () => {
    expect(parsePipeSection('Ø60.3x2.77')).toEqual({ od: 60.3, wall: 2.77, source: 'olcu' });
    expect(parsePipeSection('60,3 x 2,9')).toEqual({ od: 60.3, wall: 2.9, source: 'olcu' });
    expect(parsePipeSection('DN50 (Ø60.3 x 2.77)')?.od).toBe(60.3);
  });
  it('uses the ASME table for DN + schedule', () => {
    expect(parsePipeSection('DN100', 'SCH 40')).toEqual({ od: 114.3, wall: 6.02, source: 'sch' });
    expect(parsePipeSection('DN50 SCH80')).toEqual({ od: 60.3, wall: 5.54, source: 'sch' });
    expect(parsePipeSection('DN100')).toBeNull();
  });
  it('matches ASME B36.10M nominal weight (DN50 Sch40 ≈ 5.44 kg/m)', () => {
    expect(pipeKgPerMetre(pipe('DN50', 'A106 Gr.B', 'm', 'SCH 40'))!).toBeCloseTo(5.44, 2);
    expect(pipeKgPerMetre(pipe('Ø114.3x6.02'))!).toBeCloseTo(16.07, 1);
  });
  it('converts mm quantities and picks density from grade', () => {
    expect(pipeKg(pipe('Ø60.3x2.77'), 12000)).toBeCloseTo(12 * 3.93, 0);
    expect(densityFor('CuNi 90/10').rho).toBe(8940);
    expect(densityFor('AISI 316L').rho).toBe(7950);
    expect(densityFor('ST37').rho).toBe(7850);
  });
  it('skips non-pipes, plastics and count units', () => {
    expect(pipeKgPerMetre({ description: 'ELBOW 90', size: 'Ø60.3x2.77', grade: '', unit: 'adet' })).toBeNull();
    expect(pipeKgPerMetre(pipe('Ø60.3x2.77', 'GRP'))).toBeNull();
    expect(pipeKgPerMetre(pipe('Ø60.3x2.77', 'P235GH', 'adet'))).toBeNull();
  });
});
