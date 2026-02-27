// HumanGateModal — blocks UI until user answers a HUMAN_GATE event

import { For, Show } from "solid-js";
import type { PipelineEvent, HumanChoice } from "../api/client.js";
import { submitHumanAnswer } from "../store/runs.js";

interface Props {
  gate: PipelineEvent;
  onClose: () => void;
}

export function HumanGateModal(props: Props) {
  const choices = (): HumanChoice[] => props.gate.humanChoices ?? [];

  async function answer(key: string) {
    await submitHumanAnswer(props.gate.runId, props.gate.nodeId!, key);
    props.onClose();
  }

  return (
    <div class="modal-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="modal">
        <h3>Human Input Required</h3>
        <p class="text-muted text-sm mb-4">
          Node <span class="font-mono">{props.gate.nodeId}</span> is waiting for your decision.
        </p>
        <div class="choices">
          <Show
            when={choices().length > 0}
            fallback={
              <div>
                <p class="text-muted text-sm mb-2">Press any key or type your answer:</p>
                <input
                  type="text"
                  placeholder="Your answer..."
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      await answer((e.target as HTMLInputElement).value);
                    }
                  }}
                  autofocus
                />
              </div>
            }
          >
            <For each={choices()}>
              {(choice) => (
                <button class="choice-btn" onClick={() => answer(choice.key)}>
                  <span class="choice-key">{choice.key}</span>
                  <span>{choice.label}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="mt-4 flex justify-between">
          <button class="btn btn-ghost btn-sm" onClick={props.onClose}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
