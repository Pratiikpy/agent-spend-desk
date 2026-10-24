import { Config } from "@remotion/cli/config";

// One frame at a time keeps the render within a small share of the machine's memory.
Config.setConcurrency(1);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setCodec("h264");
Config.setCrf(18);
Config.setOverwriteOutput(true);
