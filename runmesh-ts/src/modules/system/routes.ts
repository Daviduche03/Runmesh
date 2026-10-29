import { Router } from "express";
import createError from "http-errors";
import { UserModel } from "../../core/db/orm.js";
import { success } from "../../core/http/responses.js";
import { currentUser, requireJwt } from "../../core/middleware/auth.js";

export const systemRouter = Router();

systemRouter.get("/", (_req, res) => {
  res.json(success({ name: "Runmesh API", version: "1.0.0" }));
});

systemRouter.get("/health", (_req, res) => {
  res.json(success({ status: "ok" }));
});

systemRouter.get("/api/me", requireJwt(), (req, res) => {
  const user = new UserModel(req.ctx.db).findById(currentUser(req).id);
  if (!user) throw createError(404, "User not found");
  res.json(
    success({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatarUrl ?? "",
      github_login: "",
    }),
  );
});
