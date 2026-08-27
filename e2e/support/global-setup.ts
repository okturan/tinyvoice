import { writeCameraY4m, writeMicWav } from "./media";

export default function globalSetup(): void {
  writeMicWav();
  writeCameraY4m();
}
