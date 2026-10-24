import React from "react";
import { Composition } from "remotion";
import { Demo, TOTAL_FRAMES } from "./Video";
import { FPS, H, W } from "./kit";

export const Root: React.FC = () => <Composition id="Demo" component={Demo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />;
