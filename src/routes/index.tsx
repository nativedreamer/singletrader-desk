import { createFileRoute } from "@tanstack/react-router";
import { SignalDesk } from "@/components/signal-desk";

export const Route = createFileRoute("/")({ component: SignalDesk });
