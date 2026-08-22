import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { RoleService } from "./role.service";

const createRole = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.createRole(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Role created successfully",
        data: result,
    });
});

const getRoles = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoleService.getRoles(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Roles fetched successfully",
        data,
        meta,
    });
});

const getRoleById = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.getRoleOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Role fetched successfully",
        data: result,
    });
});

const updateRole = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.updateRole(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Role updated successfully",
        data: result,
    });
});

const deleteRole = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.deleteRole(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Role deleted successfully",
        data: result,
    });
});

const createPermission = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.createPermission(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Permission created successfully",
        data: result,
    });
});

const getPermissions = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoleService.getPermissions(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Permissions fetched successfully",
        data,
        meta,
    });
});

const getPermissionById = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.getPermissionOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Permission fetched successfully",
        data: result,
    });
});

const updatePermission = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.updatePermission(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Permission updated successfully",
        data: result,
    });
});

const deletePermission = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.deletePermission(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Permission deleted successfully",
        data: result,
    });
});

const assignPermissionToRole = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.assignPermissionToRole(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Permission assigned to role successfully",
        data: result,
    });
});

const revokePermissionFromRole = catchAsync(async (req: Request, res: Response) => {
    const result = await RoleService.revokePermissionFromRole(
        req.params.id as string,
        req.params.permissionId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Permission revoked from role successfully",
        data: result,
    });
});

export const RoleController = {
    createRole,
    getRoles,
    getRoleById,
    updateRole,
    deleteRole,
    createPermission,
    getPermissions,
    getPermissionById,
    updatePermission,
    deletePermission,
    assignPermissionToRole,
    revokePermissionFromRole,
};
