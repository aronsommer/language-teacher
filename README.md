# Language Teacher

**[aronsommer.github.io/language-teacher](https://aronsommer.github.io/language-teacher/)**

Learn a language by speaking with an AI teacher, right in the browser.

## How it works

The app is a static page without a backend. Your browser talks directly to the Gemini API through the official `@google/genai` SDK, loaded from a CDN, using your own API key. The key is stored only in your browser.

It uses two models:

- **`gemini-3.8-live`** (Live API) holds the conversation. One connection stays open for the whole lesson: your microphone audio streams in, and the teacher's voice streams back together with a transcript of both sides.
- **`gemini-3.5-flash-lite`** translates. Each piece of the transcript goes out as a separate request and comes back as a translation plus the meaning of every word.

## License

Copyright (C) 2026 Aron Sommer.

This project is licensed under the GNU Affero General Public License v3.0 or later. See the [LICENSE](LICENSE) file for full details.
