import { notFound } from "next/navigation";
import { Devices } from "../Shelves";
import { deskUser } from "../session";
import { deskDevices } from "../source";

export const metadata = { title: "Devices" };

export default async function DeskDevices() {
  const user = await deskUser();
  const devices = await deskDevices(user.id);
  if (!devices) notFound();
  return <Devices devices={devices} />;
}
