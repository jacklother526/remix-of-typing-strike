// Voice cue player. Tries a recorded clip at /voice/<cue>.mp3 first; if the file
// is missing it falls back to the browser's built-in speech (a placeholder that
// actually says the English word now). Drop real clips into public/voice/ later
// and they override the placeholder automatically — no code changes needed.

export type VoiceCue = "ready" | "fire" | "destroy" | "goodjob" | "newletter";

const SPOKEN: Record<VoiceCue, string> = {
  ready: "Ready?",
  fire: "Fire!",
  destroy: "Destroy!",
  goodjob: "Good job!",
  newletter: "New letter",
};

// Cache whether a recorded file exists (undefined = not yet probed).
const fileExists: Record<string, boolean | undefined> = {};

function playFile(url: string) {
  try {
    const a = new Audio(url);
    a.volume = 1;
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function speak(cue: VoiceCue, text?: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const phrase = text ?? SPOKEN[cue] ?? cue;
  try {
    const u = new SpeechSynthesisUtterance(phrase);
    u.rate = 0.92;
    u.pitch = 1.15;
    u.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function playVoice(cue: VoiceCue, text?: string) {
  const url = `/voice/${cue}.mp3`;
  const known = fileExists[cue];
  if (known === true) {
    playFile(url);
    return;
  }
  if (known === false) {
    speak(cue, text);
    return;
  }
  // Probe once, then act.
  fetch(url, { method: "HEAD" })
    .then((r) => {
      fileExists[cue] = r.ok;
      if (r.ok) playFile(url);
      else speak(cue, text);
    })
    .catch(() => {
      fileExists[cue] = false;
      speak(cue, text);
    });
}
