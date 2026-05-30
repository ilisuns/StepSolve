import posterImage from './assets/stepsolve-poster.png';

type JiechiPosterProps = {
  onEnter: () => void;
};

export function JiechiPoster({ onEnter }: JiechiPosterProps) {
  return (
    <section className="posterImageOverlay" role="dialog" aria-modal="true">
      <button type="button" className="posterImageSkip" onClick={onEnter}>Skip</button>
      <button type="button" className="posterImageButton" onClick={onEnter} aria-label="进入解池">
        <img src={posterImage} alt="StepSolve poster: stuck on homework, enter StepSolve" />
      </button>
    </section>
  );
}

