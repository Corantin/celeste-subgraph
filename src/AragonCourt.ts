import { BigInt, Bytes, Address, ethereum, log } from "@graphprotocol/graph-ts"
import { BLACKLISTED_MODULES } from "../helpers/blacklisted-modules"
import { updateCurrentSubscriptionPeriod } from "./Subscriptions"
import { ERC20 as ERC20Contract } from "../types/AragonCourt/ERC20"
import { JurorsRegistry as JurorsRegistryContract } from "../types/templates/JurorsRegistry/JurorsRegistry"
import { BrightIdRegister as BrightIdRegisterContract } from "../types/AragonCourt/BrightIdRegister"
import {
  ERC20,
  CourtModule,
  CourtConfig,
  CourtTerm,
  BrightIdRegisterModule,
  JurorsRegistryModule,
} from "../types/schema"
import {
  BrightIdRegister,
  DisputeManager,
  JurorsRegistry,
  Treasury,
  Voting,
  Subscriptions,
} from "../types/templates"
import {
  AragonCourt,
  Heartbeat,
  ModuleSet,
  FundsGovernorChanged,
  ConfigGovernorChanged,
  FeesUpdaterChanged,
  ModulesGovernorChanged,
} from "../types/AragonCourt/AragonCourt"

let DISPUTE_MANAGER_TYPE = "DisputeManager"
let JURORS_REGISTRY_TYPE = "JurorsRegistry"
let VOTING_TYPE = "Voting"
let TREASURY_TYPE = "Treasury"
let SUBSCRIPTIONS_TYPE = "Subscriptions"
let BRIGHTID_REGISTER_TYPE = "BrightIdRegister"

let DISPUTE_MANAGER_ID =
  "0x14a6c70f0f6d449c014c7bbc9e68e31e79e8474fb03b7194df83109a2d888ae6"
let JURORS_REGISTRY_ID =
  "0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370"
let VOTING_ID =
  "0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346"
let TREASURY_ID =
  "0x06aa03964db1f7257357ef09714a5f0ca3633723df419e97015e0c7a3e83edb7"
let SUBSCRIPTIONS_ID =
  "0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365"
let BRIGHTID_REGISTER_ID =
  "0xc8d8a5444a51ecc23e5091f18c4162834512a4bc5cae72c637db45c8c37b3329"

export function handleHeartbeat(event: Heartbeat): void {
  let config = loadOrCreateConfig(event.address, event)
  config.currentTerm = event.params.currentTermId

  let court = AragonCourt.bind(event.address)
  config.fundsGovernor = court.getFundsGovernor()
  config.configGovernor = court.getConfigGovernor()
  config.modulesGovernor = court.getModulesGovernor()
  config.save()

  let previousTerm = loadOrCreateTerm(event.params.previousTermId, event)
  let previousTermResult = court.getTerm(event.params.previousTermId)
  previousTerm.court = event.address.toHexString()
  previousTerm.startTime = previousTermResult.value0
  previousTerm.randomnessBN = previousTermResult.value1
  previousTerm.randomness = previousTermResult.value2
  previousTerm.save()

  let currentTerm = loadOrCreateTerm(event.params.currentTermId, event)
  let currentTermResult = court.getTerm(event.params.currentTermId)
  currentTerm.court = event.address.toHexString()
  currentTerm.startTime = currentTermResult.value0
  currentTerm.randomnessBN = currentTermResult.value1
  currentTerm.randomness = currentTermResult.value2
  currentTerm.save()

  let subscriptions = court.getSubscriptions()
  if (!isModuleBlacklisted(subscriptions)) {
    updateCurrentSubscriptionPeriod(subscriptions, event.block.timestamp)
  }
}

export function handleFundsGovernorChanged(event: FundsGovernorChanged): void {
  let config = loadOrCreateConfig(event.address, event)
  config.fundsGovernor = event.params.currentGovernor
  config.save()
}

export function handleConfigGovernorChanged(
  event: ConfigGovernorChanged
): void {
  let config = loadOrCreateConfig(event.address, event)
  config.configGovernor = event.params.currentGovernor
  config.save()
}

export function handleFeesUpdaterChanged(event: FeesUpdaterChanged): void {
  let config = loadOrCreateConfig(event.address, event)
  config.feesUpdater = event.params.currentFeesUpdater
  config.save()
}

export function handleModulesGovernorChanged(
  event: ModulesGovernorChanged
): void {
  let config = loadOrCreateConfig(event.address, event)
  config.modulesGovernor = event.params.currentGovernor
  config.save()
}

export function handleModuleSet(event: ModuleSet): void {
  let newModuleAddress: Address = event.params.addr

  if (isModuleBlacklisted(newModuleAddress)) {
    log.warning("Ignoring blacklisted module {}", [
      newModuleAddress.toHexString(),
    ])
    return
  }

  // avoid duplicated modules
  let config = CourtConfig.load(event.address.toHexString())!
  if (isModuleAlreadySet(config.moduleAddresses, newModuleAddress)) {
    log.warning("Ignoring already set module {}", [
      newModuleAddress.toHexString(),
    ])
    return
  }

  let module = new CourtModule(event.params.id.toHexString())
  module.court = event.address.toHexString()
  module.address = newModuleAddress

  let id = event.params.id.toHexString()
  if (id == JURORS_REGISTRY_ID) {
    JurorsRegistry.create(newModuleAddress)
    module.type = JURORS_REGISTRY_TYPE

    let jurorsRegistry = JurorsRegistryContract.bind(newModuleAddress)
    let anjAddress = jurorsRegistry.token()

    let anjContract = ERC20Contract.bind(anjAddress)
    let anj = new ERC20(anjAddress.toHexString())
    anj.name = anjContract.name()
    anj.symbol = anjContract.symbol()
    anj.decimals = anjContract.decimals()
    anj.save()

    config.anjToken = anjAddress.toHexString()
    config.save()

    let registryModule = new JurorsRegistryModule(
      newModuleAddress.toHexString()
    )
    registryModule.court = event.address.toHexString()
    registryModule.totalStaked = BigInt.fromI32(0)
    registryModule.totalActive = BigInt.fromI32(0)
    registryModule.totalDeactivation = BigInt.fromI32(0)
    registryModule.save()
  } else if (id == DISPUTE_MANAGER_ID) {
    DisputeManager.create(newModuleAddress)
    module.type = DISPUTE_MANAGER_TYPE
  } else if (id == VOTING_ID) {
    Voting.create(newModuleAddress)
    module.type = VOTING_TYPE
  } else if (id == TREASURY_ID) {
    Treasury.create(newModuleAddress)
    module.type = TREASURY_TYPE
  } else if (id == SUBSCRIPTIONS_ID) {
    Subscriptions.create(newModuleAddress)
    module.type = SUBSCRIPTIONS_TYPE
  } else if (id == BRIGHTID_REGISTER_ID) {
    BrightIdRegister.create(newModuleAddress)
    module.type = BRIGHTID_REGISTER_TYPE

    let brightIdRegister = BrightIdRegisterContract.bind(newModuleAddress)

    let brightIdRegisterModule = new BrightIdRegisterModule(
      newModuleAddress.toHexString()
    )
    brightIdRegisterModule.court = event.address.toHexString()

    brightIdRegisterModule.verifiers = brightIdRegister
      .getBrightIdVerifiers()
      .map<Bytes>(address => address)
    brightIdRegisterModule.registrationPeriod = brightIdRegister.registrationPeriod()
    brightIdRegisterModule.verificationTimestampVariance = brightIdRegister.verificationTimestampVariance()
    brightIdRegisterModule.save()
  } else {
    module.type = "Unknown"
  }

  let moduleAddresses = config.moduleAddresses
  moduleAddresses.push(newModuleAddress.toHexString())
  config.moduleAddresses = moduleAddresses
  config.save()

  module.save()
}

function isModuleBlacklisted(module: Address): boolean {
  return BLACKLISTED_MODULES.includes(module.toHexString())
}

function isModuleAlreadySet(modules: string[], newModule: Address): boolean {
  return modules.includes(newModule.toHexString())
}

function loadOrCreateConfig(
  courtAddress: Address,
  event: ethereum.Event
): CourtConfig {
  let id = courtAddress.toHexString()
  let config = CourtConfig.load(id)
  let court = AragonCourt.bind(event.address)

  if (config === null) {
    config = new CourtConfig(id)
    config.currentTerm = BigInt.fromI32(0)
    config.termDuration = court.getTermDuration()
    config.moduleAddresses = []
  }

  let currentTermId = court.getCurrentTermId()
  let result = court.getConfig(currentTermId)

  let feeTokenAddress = result.value0
  let feeTokenContract = ERC20Contract.bind(feeTokenAddress)
  let feeToken = new ERC20(feeTokenAddress.toHexString())
  feeToken.name = feeTokenContract.name()
  feeToken.symbol = feeTokenContract.symbol()
  feeToken.decimals = feeTokenContract.decimals()
  feeToken.save()

  config.feeToken = feeTokenAddress.toHexString()
  config.jurorFee = result.value1[0]
  config.draftFee = result.value1[1]
  config.settleFee = result.value1[2]
  config.maxRulingOptions = result.value2
  config.evidenceTerms = result.value3[0]
  config.commitTerms = result.value3[1]
  config.revealTerms = result.value3[2]
  config.appealTerms = result.value3[3]
  config.appealConfirmationTerms = result.value3[4]
  config.firstRoundJurorsNumber = result.value3[5]
  config.appealStepFactor = result.value3[6]
  config.maxRegularAppealRounds = result.value3[7]
  config.finalRoundLockTerms = result.value3[8]
  config.penaltyPct = result.value4[0]
  config.finalRoundReduction = result.value4[1]
  config.appealCollateralFactor = result.value5[0]
  config.appealConfirmCollateralFactor = result.value5[1]
  config.minActiveBalance = result.value6[0]
  config.minMaxPctTotalSupply = result.value6[1]
  config.maxMaxPctTotalSupply = result.value6[2]

  return config
}

function loadOrCreateTerm(id: BigInt, event: ethereum.Event): CourtTerm {
  let term = CourtTerm.load(id.toString())

  if (term === null) {
    term = new CourtTerm(id.toString())
    term.createdAt = event.block.timestamp
  }

  return term
}
