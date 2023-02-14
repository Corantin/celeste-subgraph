import { concat } from "./bytes";
import { Agreement } from "../generated/templates/DisputeManager/Agreement";
import { Disputable, Dispute } from "../generated/schema";
import {
  crypto,
  Bytes,
  Address,
  BigInt,
  log,
  ByteArray,
} from "@graphprotocol/graph-ts";

// Rinkeby agreement-1hive.open.aragonpm.eth:
// const AGREEMENT_OPEN_APP_ID = '41dd0b999b443a19321f2f34fe8078d1af95a1487b49af4c2ca57fb9e3e5331e'

// xDai agreement.open.aragonpm.eth:
const AGREEMENT_OPEN_APP_ID =
  "34c62f3aec3073826f39c2c35e9a1297d9dbf3cc77472283106f09eee9cf47bf";

const AGREEMENT_APP_ID_LENGTH = AGREEMENT_OPEN_APP_ID.length;
const AGREEMENT_DISPUTE_METADATA_LENGTH = 64; // "[APP_ID][CHALLENGE_ID]" = 32 + 32

export function tryDecodingAgreementMetadata(dispute: Dispute): void {
  let rawMetadata = dispute.rawMetadata;
  if (rawMetadata.length != AGREEMENT_DISPUTE_METADATA_LENGTH) return;

  let header = Bytes.fromUint8Array(
    rawMetadata.subarray(0, AGREEMENT_APP_ID_LENGTH / 2)
  );
  let actualAppId = header.toHexString().slice(2);
  if (actualAppId != AGREEMENT_OPEN_APP_ID) return;

  let rawChallengeId = Bytes.fromUint8Array(
    rawMetadata.subarray(AGREEMENT_APP_ID_LENGTH / 2, rawMetadata.length)
  );
  let challengeId = BigInt.fromSignedBytes(
    Bytes.fromUint8Array(rawChallengeId.reverse())
  );
  let agreement = Agreement.bind(Address.fromString(dispute.subject));
  let challengeData = agreement.try_getChallenge(challengeId);

  if (
    challengeData.reverted ||
    challengeData.value.value1.toHexString() ==
      "0x0000000000000000000000000000000000000000"
  )
    return;

  let actionId = challengeData.value.value0;
  let actionData = agreement.try_getAction(actionId);
  if (actionData.reverted) return;

  let settingData = agreement.try_getSetting(actionData.value.value3);
  if (settingData.reverted) return;

  let organization = agreement.try_kernel();
  if (organization.reverted) return;

  let disputable = new Disputable(
    buildAgreementActionId(agreement._address, challengeId)
  );
  disputable.dispute = dispute.id;
  disputable.title = settingData.value.value2;
  disputable.agreement = settingData.value.value3.toString();
  disputable.actionId = actionId;
  disputable.challengeId = challengeId;
  disputable.address = actionData.value.value0;
  disputable.actionContext = actionData.value.value6.toString();
  disputable.rawActionContext = actionData.value.value6;
  disputable.challengeContext = challengeData.value.value3.toString();
  disputable.rawChallengeContext = challengeData.value.value3;
  disputable.disputableActionId = actionData.value.value1;
  disputable.defendant = actionData.value.value4;
  disputable.plaintiff = challengeData.value.value1;
  disputable.organization = organization.value;
  disputable.save();
}

function buildAgreementActionId(agreement: Address, actionId: BigInt): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto
    .keccak256((agreement as ByteArray).concat(ByteArray.fromBigInt(actionId)))
    .toHexString();
}
