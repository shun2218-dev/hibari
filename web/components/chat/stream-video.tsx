"use client";

import { useEffect, useRef } from "react";

/**
 * MediaStream（カメラと共有された画面。ADR 0068）を映す `<video>`。ハドルのタイルと参加前のプレビューに渡す。
 *
 * ストリームはチャットのタブ（通話を持つタブ）のもので、ハドルのタブ（about:blank）に portal で描いた `<video>` にもそのまま映せる
 * （Chrome で確かめた。開き直した別のタブでも同じストリームを映せる）。
 * 音は鳴らさない（muted）。受けた音声は通話の係が別の `<audio>` で鳴らすので、ここで鳴らすと二重になる。
 */
export function StreamVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    // 自動再生の制限で止まることがある（ハドルのボタンを押した後なので、たいていは再生できる）
    void video.play()?.catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted />;
}
