import { Child, Command } from "@tauri-apps/api/shell";
import { useEffect, useState } from "react";

export default function useBackend() {
    const [process, setProcess] = useState<Child>();
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        async function startBackend() {
            const command = new Command('services', ['--urls', 'http://localhost:50000']);
            const process = await command.spawn();
            console.log(`Process started: ${process.pid}`);
            setProcess(process);

            let count = 0;
            const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
            while (true) {
                try {
                    await (await fetch('http://localhost:50000')).text();
                    break;
                }
                catch (error: any) {
                    console.log(error);
                }
                console.log(`Waiting for server... ${++count}`);
                await sleep(1000);
            }
            return process;
        }
        if (process) {
            console.log(`backend has process ${process.pid}`);
        } else if (starting) {
            console.log(`backend is already starting`);
        }
        else {
            console.log('backend has no process, starting...' );
            setStarting(true);
            startBackend().then(p => {
                console.log(`Got process ${p.pid}`);
            });
        }

        return () => {
            console.log(`Killing process ${process?.pid}`);
        }
    }, []);

    return process;
}