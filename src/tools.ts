import { PermissionFlagsBits } from "discord-api-types/v10";

export function hasPermission(permissions: bigint, bit: bigint): boolean {
    return (permissions & bit) === bit
        || (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator;
}

export const trim = (str: string, max: number) => (str.length > max ? str.slice(0, max - 1) + "…" : str);
