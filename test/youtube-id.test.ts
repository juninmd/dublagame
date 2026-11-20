import { expect, test } from "bun:test";
import { youtubeId } from "../src/pipeline";

test("youtubeId aceita as formas validas de URL", () => {
  expect(youtubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
});

test("youtubeId recusa id que escaparia de DATA_DIR/videos", () => {
  expect(youtubeId("https://www.youtube.com/watch?v=../../../..")).toBeNull();
  expect(youtubeId("https://youtu.be/..%2F..%2F..%2Fx")).toBeNull();
  expect(youtubeId("https://www.youtube.com/watch?v=short")).toBeNull();
  expect(youtubeId("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
});
