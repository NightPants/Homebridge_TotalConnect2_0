/**
 * Partial response shapes for the Total Connect REST endpoints we use.
 * Only fields consumed by the plugin are declared; everything is optional because
 * the service is known to omit fields depending on panel type and firmware.
 */

export interface ApiResult {
  ResultCode?: number;
  ResultData?: string;
}

export interface BootstrapConfig {
  clientId: string;
  publicKeyPem: string;
  appId: number;
  appVersion: string;
  authUrl: string;
  resourceUrl: string;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface DeviceInfoBasic {
  DeviceID: number;
  DeviceName?: string;
  DeviceClassID?: number;
  DeviceSerialNumber?: string;
  DeviceType?: string;
}

export interface LocationInfoBasic {
  LocationID: number;
  LocationName: string;
  SecurityDeviceID: number;
  LocationModuleFlags?: string;
  DeviceList?: DeviceInfoBasic[];
}

export interface SessionDetails {
  ModuleFlags?: string;
  UserInfo?: { UserID?: number; Username?: string; Fullname?: string; IsOtpEnabled?: number };
  Locations?: LocationInfoBasic[];
}

export interface SessionDetailsResponse extends ApiResult {
  SessionDetailsResult?: SessionDetails;
}

export interface PartitionInfo {
  PartitionID: number;
  PartitionName?: string;
  ArmingState?: number;
  PartitionArmingState?: number;
  IsNightStayEnabled?: number | boolean;
  IsStayArmed?: boolean;
  ExitDelayTimer?: number;
  IsAlarmResponded?: boolean;
}

export interface PartitionConfigResponse extends ApiResult {
  Partitions?: PartitionInfo[];
}

export interface ZoneInfo {
  ZoneID: number;
  ZoneDescription?: string;
  ZoneStatus?: number;
  PartitionID?: number;
  PartitionId?: number;
  CanBeBypassed?: number | boolean;
  ZoneTypeID?: number;
  ZoneTypeId?: number;
  DeviceType?: number;
  Batterylevel?: number;
  Signalstrength?: number;
}

export interface PanelStatus {
  Zones?: ZoneInfo[];
  Partitions?: PartitionInfo[];
  IsInACLoss?: boolean;
  IsInLowBattery?: boolean;
  IsCoverTampered?: boolean;
  IsInRfJam?: boolean;
  IsInBatteryMissing?: boolean;
  LastUpdatedTimestampTicks?: number;
  ConfigurationSequenceNumber?: number;
}

export interface FullStatusResponse extends ApiResult {
  PanelStatus?: PanelStatus;
  ArmingState?: number;
}

export interface ZoneDetailsResponse extends ApiResult {
  ZoneStatus?: { Zones?: ZoneInfo[] };
}

export interface CommandResponse extends ApiResult {
  StatusChange?: { PartitionStateChange?: { PartitionId: number; Result: number }[] };
}

export interface BypassResponse extends ApiResult {
  Zones?: { ZoneID: number; ZoneStatus: number }[];
}

