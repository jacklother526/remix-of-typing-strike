# Voice clips

Drop recorded voice clips here to replace the placeholder (browser speech).
Files are matched by cue name — add any of:

- `ready.mp3` — spoken during the pre-wave countdown ("Ready?")
- `fire.mp3` — when the wave starts ("Fire!")
- `destroy.mp3` — on big combo / charged moments ("Destroy!")
- `goodjob.mp3` — when a level is cleared ("Good job!")
- `newletter.mp3` — when a new letter is introduced ("New letter!")

As soon as a matching file exists at `/voice/<cue>.mp3`, the game uses it
instead of the placeholder voice. No code changes needed.
