/**
 * Processes per-user Opus audio from Discord into 16kHz mono 16-bit PCM
 * and sends it to the Python backend via WebSocket.
 *
 * Discord sends 48kHz stereo PCM after Opus decoding.
 * We downsample to 16kHz mono for Deepgram/Silero.
 */

/**
 * Downsample 48kHz stereo PCM (16-bit LE) to 16kHz mono PCM (16-bit LE).
 * Simple decimation: pick every 3rd sample from the left channel.
 * For speech this is perfectly adequate.
 */
export function downsample48kStereoTo16kMono(buffer) {
  const input = new Int16Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / 2
  );

  // Stereo = 2 samples per frame. 48k→16k = take every 3rd frame.
  const inputFrames = Math.floor(input.length / 2);
  const outputFrames = Math.floor(inputFrames / 3);
  const output = new Int16Array(outputFrames);

  for (let i = 0; i < outputFrames; i++) {
    // Left channel of every 3rd stereo frame
    output[i] = input[i * 3 * 2];
  }

  return Buffer.from(output.buffer);
}
