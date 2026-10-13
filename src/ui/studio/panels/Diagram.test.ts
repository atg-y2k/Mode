import { describe, expect, it } from 'vitest';
import { DIAGRAM_IDS, ELEMENT_DEFS } from '../../../assets/design';
import { diagramDescription, hasDiagramDrawing } from './Diagram';

describe('option diagrams', () => {
  it('draws every diagram id of the design knowledge base', () => {
    const missing = Object.keys(DIAGRAM_IDS).filter((id) => !hasDiagramDrawing(id));
    expect(missing).toEqual([]);
  });

  it('draws every diagram the built-in element options use', () => {
    const used = new Set<string>();
    for (const def of ELEMENT_DEFS) {
      for (const dim of def.dimensions) for (const o of dim.options) if (o.visual?.kind === 'diagram') used.add(o.visual.diagram);
    }
    expect([...used].filter((id) => !hasDiagramDrawing(id))).toEqual([]);
  });

  it('describes known ids', () => {
    expect(diagramDescription('path-curved')).toMatch(/curve/i);
    expect(diagramDescription('not-a-diagram')).toBeUndefined();
  });
});
