import React from 'react';
import {AbsoluteFill, Composition, OffthreadVideo, Sequence, cancelRender, continueRender, delayRender, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

type Caption = {text: string; start: number; end: number};
type Cue = {start: number; end: number; kind: string; title: string; subtitle?: string; subtitleStart?: number; items?: {text: string; start: number}[]};
type Props = {duration: number; captions: Caption[]; cues: Cue[]};
const BLUE = '#49B5FF';
const WHITE = '#FFFFFF';

const useFont = () => {
  const [handle] = React.useState(() => delayRender('Loading HarmonyOS font'));
  React.useEffect(() => {
    const font = new FontFace('Harmony', `url(${staticFile('HarmonyOS_Sans_SC_Bold.ttf')})`);
    font.load().then((loaded) => {
      (document.fonts as FontFaceSet & {add: (face: FontFace) => void}).add(loaded);
      continueRender(handle);
    }).catch(cancelRender);
  }, [handle]);
};

export const MotionCue: React.FC<{cue: Cue}> = ({cue}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const intro = spring({frame, fps, config: {damping: 20, stiffness: 115, mass: 0.75}});
  const life = (cue.end - cue.start) * fps;
  const outro = interpolate(frame, [life - 7, life], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const time = cue.start + frame / fps;
  const title = cue.subtitle && time >= (cue.subtitleStart ?? cue.end) ? cue.subtitle : cue.title;
  const fontSize = title.length > 7 ? 76 : 94;
  const headline = <div style={{fontSize, lineHeight: 1.18, color: WHITE, textShadow: '0 3px 12px #000b', display: 'flex', justifyContent: 'center', gap: 22}}>
    {cue.kind === 'promise' && <span style={{fontSize: 68, color: BLUE, transform: `scale(${intro})`}}>&#10003;</span>}{title}
  </div>;
  return <div style={{position: 'absolute', top: 100, left: 70, width: 940, height: 250, textAlign: 'center', opacity: outro, transform: `translateY(${(1 - intro) * -26}px) scale(${0.94 + intro * 0.06})`}}>
    {cue.kind === 'categories' ? <div style={{display: 'flex', gap: 18, justifyContent: 'center', paddingTop: 18}}>{cue.items?.map((item, index) => {
      const progress = time < item.start ? 0 : spring({frame: Math.floor((time - item.start) * fps), fps, config: {damping: 19}});
      return <div key={item.text} style={{width: 185, opacity: progress, transform: `translateY(${(1 - progress) * 30}px)`}}><div style={{fontSize: 20, color: BLUE, marginBottom: 8}}>{String(index + 1).padStart(2, '0')}</div><div style={{fontSize: 63}}>{item.text}</div><div style={{height: 5, background: BLUE, marginTop: 17, transform: `scaleX(${progress})`}}/></div>;
    })}</div> : <>
      {cue.kind === 'name' && <div style={{position: 'absolute', top: -42, width: '100%', fontSize: 27, color: BLUE}}>兰军建材城</div>}
      {headline}
      <div style={{height: cue.kind === 'promise' ? 8 : 5, width: cue.kind === 'name' ? 180 : 360, background: cue.kind === 'contrast' ? '#FFC66D' : BLUE, margin: '22px auto 0', transform: `scaleX(${Math.min(1, Math.max(0, (frame - 3) / 15))})`, transformOrigin: 'left'}}/>
    </>}
  </div>;
};

export const NaturalTalk: React.FC<Props> = ({duration, captions, cues}) => {
  useFont();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const time = frame / fps;
  const caption = captions.find((item) => time >= item.start && time < item.end);
  const zoom = 1.0 + 0.018 * (1 - Math.cos(time * Math.PI / 9)) / 2;
  const opacity = interpolate(time, [0, 0.12, duration - 0.22, duration], [0, 1, 1, 0], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{background: 'black', fontFamily: 'Harmony', color: WHITE, letterSpacing: 0}}>
    <AbsoluteFill style={{opacity}}>
      <OffthreadVideo src={staticFile('video.mp4')} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: '50% 100%'}} volume={1}/>
      <AbsoluteFill style={{background: 'linear-gradient(to bottom, rgba(0,0,0,.60) 0%, rgba(0,0,0,.22) 16%, transparent 24%, transparent 77%, rgba(0,0,0,.52) 100%)'}}/>
      {cues.map((cue, index) => <Sequence key={index} from={Math.ceil(cue.start * fps)} durationInFrames={Math.max(1, Math.floor((cue.end - cue.start) * fps))}><MotionCue cue={cue}/></Sequence>)}
      {caption && <div style={{position: 'absolute', top: 1640, left: 75, width: 930, height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: `translateY(${interpolate(time - caption.start, [0, 0.12], [12, 0], {extrapolateRight: 'clamp'})}px)`}}>
        <div style={{fontSize: 59, lineHeight: 1.3, textAlign: 'center', textShadow: '0 3px 5px #000, 0 0 14px #000a', WebkitTextStroke: '1px #2226'}}>{caption.text}</div>
        <div style={{height: 4, background: BLUE, width: 110, marginTop: 17, transform: `scaleX(${interpolate(time, [caption.start, caption.end], [0.15, 1])})`, transformOrigin: 'left'}}/>
      </div>}
    </AbsoluteFill>
  </AbsoluteFill>;
};

const Root = () => <Composition id="NaturalTalk" component={NaturalTalk} width={1080} height={1920} fps={25} durationInFrames={1500} defaultProps={{duration: 60, captions: [], cues: []}} calculateMetadata={({props}) => ({durationInFrames: Math.ceil(props.duration * 25)})}/>;
registerRoot(Root);
