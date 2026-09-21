import { type NoteGroup } from '@/data/fragrances';
import { sceneVisibility, type SceneTiming } from '@/data/scene-choreography';

type FragranceNotesProps = {
  group: NoteGroup;
  groupIndex: number;
  progress: number;
  timing: SceneTiming;
};

export function FragranceNotes({ group, groupIndex, progress, timing }: FragranceNotesProps) {
  const opacity = sceneVisibility(progress, timing);
  const arrangement = groupIndex === 0 ? 'top' : groupIndex === 1 ? 'alt' : 'base';

  return (
    <div className="scene-note-layer" aria-label={`${group.label} for this fragrance`}>
      <div className="scene-kicker" style={{ position: 'absolute', top: '20%', left: '50%', opacity: opacity * 0.8, transform: `translateX(-50%) translateY(${(1 - opacity) * 10}px)` }}>
        {group.label}
      </div>
      {group.notes.map((note, index) => (
        <span
          className={`note-field ${arrangement}-${index === 0 ? 'top' : index === 1 ? 'middle' : 'bottom'} ${index === 0 ? 'top' : index === 1 ? 'middle' : 'bottom'}`}
          key={`${group.label}-${index}`}
          style={{
            opacity,
            transform: `translate3d(${(1 - opacity) * (index % 2 ? 14 : -14)}px, ${(1 - opacity) * 16}px, 0)`,
          }}
        >
          {note}
        </span>
      ))}
    </div>
  );
}