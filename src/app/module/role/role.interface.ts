export interface ICreateRolePayload {
    name: string;
    description?: string;
}

export type IUpdateRolePayload = Partial<ICreateRolePayload>;

export interface ICreatePermissionPayload {
    name: string;
    description?: string;
}

export type IUpdatePermissionPayload = Partial<ICreatePermissionPayload>;

export interface IAssignPermissionPayload {
    permissionId: string;
}
