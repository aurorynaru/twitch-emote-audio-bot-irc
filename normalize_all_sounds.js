import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLAYSOUNDS_DIR = path.join(__dirname, 'data', 'playsounds');


const TARGET_I = -27;
const TARGET_TP = -9;
const TARGET_LRA = 8;
const SHORT_TARGET_MAX_VOLUME = -20;


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


async function normalizeShortAudioByPeak(filePath, tempPath) {
  const volumeStats = await getVolumeDetectStats(filePath);

  if (!volumeStats) {
    console.error("Could not get volume stats for short audio:", filePath);
    return false;
  }

  const maxVolume = Number(volumeStats.maxVolume);
  const meanVolume = Number(volumeStats.meanVolume);

  if (!Number.isFinite(maxVolume)) {
    console.error("Invalid max volume for short audio:", filePath, volumeStats);
    return false;
  }



  let gainDb = SHORT_TARGET_MAX_VOLUME - maxVolume;


  gainDb = clamp(gainDb, -24, 6);

  console.log("Short audio fallback:", {
    filePath,
    meanVolume,
    maxVolume,
    gainDb
  });


  const cmd =
    `ffmpeg -hide_banner -i "${filePath}" ` +
    `-af "volume=${gainDb}dB" ` +
    `-y "${tempPath}"`;

  const result = await runCommand(cmd);

  if (result.error) {
    console.error("Short audio fallback failed for " + filePath, result.error);
    console.error(result.stderr);
    return false;
  }

  const finalStats = await getVolumeDetectStats(tempPath);

  console.log("After short audio fallback:", {
    filePath,
    meanVolume: finalStats?.meanVolume,
    maxVolume: finalStats?.maxVolume
  });

  return true;
}

function isShortOrUnmeasurableLoudnormStats(stats) {
  if (!stats) return false;

  return (
    stats.input_i === "-inf" ||
    stats.output_i === "-inf" ||
    stats.target_offset === "inf" ||
    stats.target_offset === "-inf"
  );
}


async function getAudioStats(filePath) {
  const verifyCmd =
    `ffmpeg -hide_banner -i "${filePath}" ` +
    `-af "loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json" ` +
    `-f null -`;

  const verify = await runCommand(verifyCmd);

  if (verify.error) {
    console.error("Audio stats check failed for " + filePath, verify.error);
    console.error(verify.stderr);
    return null;
  }

  return extractLoudnormStats(verify.stderr);
}

function extractVolumeDetectStats(stderr) {
  const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  const maxMatch = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);

  if (!meanMatch || !maxMatch) {
    return null;
  }

  return {
    meanVolume: Number(meanMatch[1]),
    maxVolume: Number(maxMatch[1])
  };
}

async function getVolumeDetectStats(filePath) {
  const cmd =
    `ffmpeg -hide_banner -i "${filePath}" ` +
    `-af "volumedetect" ` +
    `-f null -`;

  const result = await runCommand(cmd);

  if (result.error) {
    console.error("volumedetect failed for " + filePath, result.error);
    console.error(result.stderr);
    return null;
  }

  return extractVolumeDetectStats(result.stderr);
}

function getDynamicFinalGainDb({
  inputI,
  inputTP,
  inputLRA,
  outputInputI,
  outputInputTP,
  outputInputLRA,
  outputMeanVolume,
  outputMaxVolume
}) {


  inputI = Number(inputI);
  inputTP = Number(inputTP);
  inputLRA = Number(inputLRA);
  outputInputI = Number(outputInputI);
  outputInputTP = Number(outputInputTP);
  outputInputLRA = Number(outputInputLRA);
  outputMeanVolume = Number(outputMeanVolume);
  outputMaxVolume = Number(outputMaxVolume);

  if (
    !Number.isFinite(inputI) ||
    !Number.isFinite(inputTP) ||
    !Number.isFinite(inputLRA) ||
    !Number.isFinite(outputInputI) ||
    !Number.isFinite(outputInputTP) ||
    !Number.isFinite(outputInputLRA)
  ) {
    return 0;
  }

  const hasVolumeDetect =
    Number.isFinite(outputMeanVolume) &&
    Number.isFinite(outputMaxVolume);


  if (hasVolumeDetect) {
    if (outputMeanVolume >= -29) {
     return -8;
    }

    if (outputMeanVolume >= -30) {
      return -5;
    }

    if (outputMeanVolume >= -31 && outputMaxVolume >= -16) {
      return -4;
    }

    if (outputMeanVolume >= -32 && outputMaxVolume >= -17) {
      return -3;
    }
  }


  if (outputInputLRA <= 0.5 && outputInputTP >= -12) {
    return -4;
  }

  if (outputInputLRA <= 1 && outputInputTP >= -15) {
    return -3;
  }

  if (outputInputTP >= -13) {
    return -4;
  }

  if (outputInputTP >= -15) {
    return -3;
  }

  if (outputInputTP >= -17) {
    return -2;
  }

  if (hasVolumeDetect) {
    if (outputMeanVolume <= -34 && outputMaxVolume <= -20) {
      return 0;
    }

    if (outputMeanVolume <= -32 && outputMaxVolume <= -19) {
      return -1;
    }
  }
  //-1
  if (outputInputTP <= -21) {
    return 0;
  }

  if (outputInputTP <= -19) {
    return 0;
  }


  if (inputI > -8 && outputInputTP > -18) {
    return -3;
  }

  if (inputI > -12 && outputInputTP > -18) {
    return -2;
  }

  if (inputI > -16 && outputInputTP > -18) {
    return -2;
  }


  //  -2
  return -1;
}

function runCommand(command) {
  return new Promise((resolve) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

function extractLoudnormStats(stderr) {
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function areStatsValid(stats) {
  if (!stats) return false;

  const inputI = Number(stats.input_i);
  const inputTP = Number(stats.input_tp);
  const inputLRA = Number(stats.input_lra);
  const inputThresh = Number(stats.input_thresh);
  const targetOffset = Number(stats.target_offset);

  return (
    Number.isFinite(inputI) &&
    Number.isFinite(inputTP) &&
    Number.isFinite(inputLRA) &&
    Number.isFinite(inputThresh) &&
    Number.isFinite(targetOffset) &&
    inputI <= 0
  );
}



async function normalizeAudioAttempt(filePath, tempPath, preFilter = "") {
  const pass1Cmd =
    `ffmpeg -hide_banner -i "${filePath}" ` +
    `-af "${preFilter}loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json" ` +
    `-f null -`;

  const pass1 = await runCommand(pass1Cmd);

  if (pass1.error) {
    console.error("FFmpeg pass 1 failed for " + filePath, pass1.error);
    console.error(pass1.stderr);
    return false;
  }

  const stats = extractLoudnormStats(pass1.stderr);

  if (!areStatsValid(stats)) {
  console.error("Invalid loudnorm stats for", filePath, stats);

  if (isShortOrUnmeasurableLoudnormStats(stats)) {
    console.warn("Using short audio fallback:", filePath);

    return await normalizeShortAudioByPeak(filePath, tempPath);
  }

  return false;
}

  const inputI = Number(stats.input_i);
  const inputTP = Number(stats.input_tp);
  const inputLRA = Number(stats.input_lra);
  const inputThresh = Number(stats.input_thresh);
  const targetOffset = Number(stats.target_offset);

  // console.log("Before normalize:", {
  //   filePath,
  //   inputI,
  //   inputTP,
  //   inputLRA,
  //   targetOffset
  // });


  const pass2Cmd =
    `ffmpeg -hide_banner -i "${filePath}" ` +
    `-af "${preFilter}loudnorm=` +
    `I=${TARGET_I}:` +
    `TP=${TARGET_TP}:` +
    `LRA=${TARGET_LRA}:` +
    `measured_I=${inputI}:` +
    `measured_TP=${inputTP}:` +
    `measured_LRA=${inputLRA}:` +
    `measured_thresh=${inputThresh}:` +
    `offset=${targetOffset}:` +
    `linear=true:` +
    `print_format=summary" ` +
    `-y "${tempPath}"`;

  const pass2 = await runCommand(pass2Cmd);

  if (pass2.error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    console.error("FFmpeg pass 2 failed for " + filePath, pass2.error);
    console.error(pass2.stderr);

    return false;
  }


  const verifyStats = await getAudioStats(tempPath);

  if (!verifyStats) {
    console.error("Failed to verify normalized file:", tempPath);
    return false;
  }

  const outputInputI = Number(verifyStats.input_i);
  const outputInputTP = Number(verifyStats.input_tp);
  const outputInputLRA = Number(verifyStats.input_lra);

  // console.log("After normalize:", {
  //   filePath,
  //   outputInputI,
  //   outputInputTP,
  //   outputInputLRA
  // });


const volumeStats = await getVolumeDetectStats(tempPath);

// console.log("Volume detect:", {
//   filePath,
//   meanVolume: volumeStats?.meanVolume,
//   maxVolume: volumeStats?.maxVolume
// });

let finalGainDb = getDynamicFinalGainDb({
  inputI,
  inputTP,
  inputLRA,
  outputInputI,
  outputInputTP,
  outputInputLRA,
  outputMeanVolume: volumeStats?.meanVolume,
  outputMaxVolume: volumeStats?.maxVolume
});
  
finalGainDb = clamp(finalGainDb, -8, 3);

// console.log("Dynamic gain decision:", {
//   filePath,
//   finalGainDb,
//   inputI,
//   inputTP,
//   inputLRA,
//   outputInputI,
//   outputInputTP,
//   outputInputLRA,
//   outputMeanVolume: volumeStats?.meanVolume,
//   outputMaxVolume: volumeStats?.maxVolume
// });


  if (finalGainDb !== 0) {
    // console.log("Applying dynamic final gain:", {
    //   filePath,
    //   finalGainDb
    // });

    const adjustedTempPath = tempPath + ".adjusted" + path.extname(filePath);

    const adjustCmd =
      `ffmpeg -hide_banner -i "${tempPath}" ` +
      `-af "volume=${finalGainDb}dB" ` +
      `-y "${adjustedTempPath}"`;

    const adjust = await runCommand(adjustCmd);

    if (adjust.error) {
      if (fs.existsSync(adjustedTempPath)) fs.unlinkSync(adjustedTempPath);

      console.error("Final dynamic volume adjust failed for " + filePath, adjust.error);
      console.error(adjust.stderr);

      return false;
    }

    fs.unlinkSync(tempPath);
    fs.renameSync(adjustedTempPath, tempPath);

    const finalVerifyStats = await getAudioStats(tempPath);

    // console.log("After dynamic adjust:", {
    //   filePath,
    //   finalInputI: finalVerifyStats?.input_i,
    //   finalInputTP: finalVerifyStats?.input_tp,
    //   finalInputLRA: finalVerifyStats?.input_lra
    // });
  }

  return true;
}

async function normalizeAudio(filePath) {
  const ext = path.extname(filePath);

  const tempPath = path.join(
    path.dirname(filePath),
    path.basename(filePath, ext) + ".tmp" + ext
  );

  try {

    let success = await normalizeAudioAttempt(filePath, tempPath, "");

    if (!success) {
      console.log("retrying with volume lowered:", filePath);

      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

      success = await normalizeAudioAttempt(filePath, tempPath, "volume=-20dB,");
    }

    if (!success) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return false;
    }

    fs.renameSync(tempPath, filePath);
    return true;
  } catch (e) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    console.error("normalization failed for " + filePath, e);
    return false;
  }
}

async function run() {
  if (!fs.existsSync(PLAYSOUNDS_DIR)) {
    console.error(`directory not found: ${PLAYSOUNDS_DIR}`);
    return;
  }

  const files = fs.readdirSync(PLAYSOUNDS_DIR);
  const audioFiles = files.filter(f => f.toLowerCase().endsWith('.mp3') || f.toLowerCase().endsWith('.ogg'));

  //console.log(`Found ${audioFiles.length} audio files in ${PLAYSOUNDS_DIR}. Starting normalization...`);
  
  let successCount = 0;
  let failCount = 0;

  const CHUNK_SIZE = 50; 
  
  for (let i = 0; i < audioFiles.length; i += CHUNK_SIZE) {
    const chunk = audioFiles.slice(i, i + CHUNK_SIZE);
    
   // process.stdout.write(`Processing batch ${Math.floor(i / CHUNK_SIZE) + 1} of ${Math.ceil(audioFiles.length / CHUNK_SIZE)} (Files ${i + 1} to ${Math.min(i + CHUNK_SIZE, audioFiles.length)})... `);
    
    const promises = chunk.map(file => normalizeAudio(path.join(PLAYSOUNDS_DIR, file)));
    const results = await Promise.all(promises);
    
    const chunkSuccesses = results.filter(r => r).length;
    successCount += chunkSuccesses;
    failCount += (chunk.length - chunkSuccesses);
    
   // console.log('Done!');
  }

//   console.log('\n--- Normalization Complete ---');
//   console.log(`Successfully normalized: ${successCount}`);
//   console.log(`Failed: ${failCount}`);
}

export { normalizeAudio };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
