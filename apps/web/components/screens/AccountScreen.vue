<script setup lang="ts">
import BusyNote from "~/components/ui/BusyNote.vue";
import { computed, ref } from "vue";
import ExplorerLink from "~/components/ui/ExplorerLink.vue";
import LedgerDevicePicker from "~/components/ui/LedgerDevicePicker.vue";
import ResultView from "~/components/ui/ResultView.vue";
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { WEBHID_MESSAGE, hasWebHid } from "~/lib/browser-support";
import { useBackend, useDemo } from "~/lib/context";
import { formatXrp, shortAddress } from "~/lib/format";
import { PROFILE_LABELS, type Profile } from "~/lib/demo";

const backend = useBackend();
const demo = useDemo();
const state = demo.state;
const passkeyOnly = ref(false);
const webHid = hasWebHid();
// The simulated Stax needs no browser support; the real one does.
const ledgerBlocked = computed(() => backend.device.mode === "live" && !webHid);

// Who signs a Ledger account's own transactions: the Stax, or, on the simulation, software keys.
const ledgerSigner = computed(() =>
  backend.device.mode === "simulated"
    ? "signed by the simulated Stax (software keys, no device involved)"
    : "signed on the device",
);

const PROFILES = computed<readonly { id: Profile; title: string; body: string; note: string }[]>(
  () => [
    {
      id: "mac",
      title: "Mac account",
      body: "Keeps its master key and has a P-256 passkey from this browser's authenticator. The passkey opens sessions; the session key is a non-extractible P-256 key.",
      note: "Not post-quantum: the P-256 passkey has full authority, its public key is on the ledger, and a passkey list cannot be replaced or removed. The node also takes ML-DSA-44 passkeys (PasskeyMLDSA), which a Stax running the carbs Security Key app can hold; this page does not make them.",
    },
    {
      id: "ledger",
      title: "Ledger account",
      body: `Master key disabled, the device's ML-DSA-44 key as regular key, never a passkey. Every own-authority transaction is ${ledgerSigner.value}.`,
      note: "Post-quantum root: ML-DSA-44 in the XRP app, without side-channel countermeasures yet. Each transaction carries a 1 312-byte key and a 2 420-byte signature. Session keys are ML-DSA-44 keys made in this page, in memory (WebCrypto has no ML-DSA, so they are extractible).",
    },
  ],
);

const masterLabel = computed(() => (state.info?.masterDisabled ? "disabled" : "enabled"));
/** The reserve this account cannot spend, from the reserves the node reports (never a constant). */
const reserve = computed(() => {
  const reserves = state.server?.reserves ?? null;
  const info = state.info;
  if (reserves === null || info === null) return null;
  const lockedDrops = reserves.baseDrops + info.ownerCount * reserves.ownerDrops;
  return {
    locked: formatXrp(lockedDrops),
    rule: `${formatXrp(reserves.baseDrops)} + ${info.ownerCount} × ${formatXrp(reserves.ownerDrops)} per owned object`,
    available: formatXrp(Math.max(0, info.balanceDrops - lockedDrops)),
  };
});
/** The account lives on the backend's node: its explorer, if it has one (the simulation has none). */
const nodeNetwork = computed(() => backend.node.explorerNetwork());
const simulated = computed(() => backend.mode === "simulated");

async function create(profile: Profile): Promise<void> {
  await demo.createAccount(profile, { passkeyOnly: profile === "mac" && passkeyOnly.value });
}

/** The Ledger account is the device's own: the same Stax always gives the same address. */
const ledgerAccountNote = computed(() =>
  backend.device.mode === "simulated"
    ? "The simulated Stax makes new keys at each setup, so each setup is a new account."
    : "The account is the Stax's own address: the same device always gives the same account. One already set up is used as it is, with nothing sent.",
);
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Account" title="Two kinds of account">
      Pick a profile. A Mac account is new each time; a Ledger account is the device's own.
      Everything below is read back from the node.
    </ScreenHeader>

    <div class="grid gap-5 md:grid-cols-2">
      <article
        v-for="profile in PROFILES"
        :key="profile.id"
        class="panel panel-stack space-y-3"
        :data-testid="`profile-${profile.id}`"
      >
        <h2 class="panel-title">{{ profile.title }}</h2>
        <p>{{ profile.body }}</p>
        <p class="text-sm text-muted-foreground">{{ profile.note }}</p>
        <label v-if="profile.id === 'mac'" class="flex items-center gap-2 text-sm">
          <input v-model="passkeyOnly" type="checkbox" data-testid="passkey-only" />
          Passkey-only recipe: regular key to the blackhole address, master key disabled
        </label>
        <p
          v-if="profile.id === 'ledger' && !webHid"
          class="text-sm text-warn"
          role="note"
          data-testid="hid-warning"
        >
          {{ WEBHID_MESSAGE }}
          <template v-if="backend.device.mode === 'simulated'">
            The simulated Stax below works in any browser; the real one needs Chrome.
          </template>
        </p>
        <LedgerDevicePicker v-if="profile.id === 'ledger' && backend.mode === 'live'" />
        <p
          v-if="profile.id === 'ledger'"
          class="text-sm text-muted-foreground"
          data-testid="ledger-account-note"
        >
          {{ ledgerAccountNote }}
        </p>
        <div class="flex flex-wrap gap-3">
          <button
            class="btn btn-primary"
            :disabled="state.busy || (profile.id === 'ledger' && ledgerBlocked)"
            :data-testid="`create-${profile.id}`"
            @click="create(profile.id)"
          >
            {{ profile.id === "mac" ? "Create a new Mac account" : "Set up the Ledger account" }}
          </button>
          <button
            v-if="profile.id === 'ledger'"
            class="btn"
            :disabled="state.busy || ledgerBlocked"
            data-testid="use-ledger"
            @click="demo.useExistingLedgerAccount()"
          >
            Use the account already set up
          </button>
        </div>
      </article>
    </div>

    <BusyNote :busy="state.busy" class="mt-4" />
    <p v-if="state.error" class="mt-4 text-danger" role="alert" data-testid="error">
      {{ state.error }}
    </p>

    <template v-if="state.address">
      <div class="mt-8 grid gap-5 lg:grid-cols-2">
        <section class="panel" data-testid="account-state">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="panel-title">State from the node</h2>
            <SimBadge v-if="backend.mode === 'simulated'" />
          </div>
          <dl v-if="state.info" class="kv">
            <dt>Address</dt>
            <dd class="mono" data-testid="address">
              <ExplorerLink
                kind="account"
                :value="state.address"
                :network="nodeNetwork"
                :simulated="simulated"
              />
            </dd>
            <dt>Profile</dt>
            <dd>
              {{ state.profile ? PROFILE_LABELS[state.profile] : ""
              }}{{ state.passkeyOnly ? " (passkey-only)" : "" }}
            </dd>
            <dt>Balance</dt>
            <dd data-testid="balance">{{ formatXrp(state.info.balanceDrops) }}</dd>
            <dt>Reserve</dt>
            <dd data-testid="reserve">
              <template v-if="reserve">
                {{ reserve.locked }}
                <span class="text-xs text-muted-foreground">
                  ({{ reserve.rule }}, as the node reports; {{ reserve.available }} available)
                </span>
              </template>
              <template v-else>not reported by the node</template>
            </dd>
            <dt>Sequence</dt>
            <dd>{{ state.info.sequence }}</dd>
            <dt>Owner count</dt>
            <dd>{{ state.info.ownerCount }}</dd>
            <dt>Master key</dt>
            <dd data-testid="master">{{ masterLabel }}</dd>
            <dt>Regular key</dt>
            <dd class="mono">
              <ExplorerLink
                v-if="state.info.regularKey"
                kind="account"
                :value="state.info.regularKey"
                :network="nodeNetwork"
                :simulated="simulated"
                :text="shortAddress(state.info.regularKey)"
              />
              <template v-else>none</template>
            </dd>
            <dt>Passkeys</dt>
            <dd>{{ state.objects?.passkeys.length ?? 0 }}</dd>
            <dt>Sessions</dt>
            <dd>{{ state.objects?.sessions.length ?? 0 }}</dd>
          </dl>
        </section>

        <section class="panel" data-testid="setup-steps">
          <h2 class="panel-title mb-3">Setup steps</h2>
          <ol class="space-y-4">
            <li v-for="step in state.steps" :key="step.id" class="space-y-1">
              <p class="text-sm">
                <span
                  :class="
                    step.status === 'ok'
                      ? 'text-ok'
                      : step.status === 'failed'
                        ? 'text-danger'
                        : 'text-muted-foreground'
                  "
                >
                  {{ step.status === "ok" ? "✓" : step.status === "failed" ? "✕" : "…" }}
                </span>
                {{ step.label }}
                <SimBadge
                  v-if="step.simulatedDevice"
                  title="Signed on the simulated device; the node's answer below is real"
                />
              </p>
              <ResultView
                v-if="step.result"
                :result="step.result"
                :simulated="backend.mode === 'simulated'"
              />
            </li>
          </ol>
        </section>
      </div>
    </template>
  </section>
</template>
