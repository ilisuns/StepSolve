import posterImage from './assets/jiechi-poster.png';

type JiechiPosterProps = {
  onEnter: () => void;
};

export function JiechiPoster({ onEnter }: JiechiPosterProps) {
  return (
    <section className="posterImageOverlay" role="dialog" aria-modal="true">
      <button type="button" className="posterImageSkip" onClick={onEnter}>跳过</button>
      <button type="button" className="posterImageButton" onClick={onEnter} aria-label="进入解池">
        <img src={posterImage} alt="解池海报：作业写不下去了？进入解池" />
      </button>
    </section>
  );
}
