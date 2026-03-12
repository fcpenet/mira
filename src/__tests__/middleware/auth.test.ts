import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole } from '../../middleware/auth';

const TEST_SECRET = 'test-secret';

function makeToken(payload: object, subject = 'user-1') {
  return jwt.sign(payload, TEST_SECRET, { subject });
}

function mockRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

describe('authenticate', () => {
  const next = jest.fn() as NextFunction;

  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with Bearer', () => {
    const req = { headers: { authorization: 'Basic abc' } } as Request;
    const res = mockRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid token', () => {
    const req = { headers: { authorization: 'Bearer not-a-token' } } as Request;
    const res = mockRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a token signed with the wrong secret', () => {
    const token = jwt.sign({ orgId: 'org-1', role: 'operator', email: 'a@b.com' }, 'wrong-secret');
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = mockRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next() for a valid token', () => {
    const token = makeToken({ orgId: 'org-1', role: 'operator', email: 'a@b.com' }, 'user-1');
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = mockRes();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      id: 'user-1',
      orgId: 'org-1',
      role: 'operator',
      email: 'a@b.com',
    });
  });
});

describe('requireRole', () => {
  const next = jest.fn() as NextFunction;

  function reqWithRole(role: string) {
    return { user: { id: 'u', orgId: 'o', role, email: 'x@y.com' } } as unknown as Request;
  }

  it('returns 403 when req.user is not set', () => {
    const req = {} as Request;
    const res = mockRes();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user role is not in the allowed list', () => {
    const req = reqWithRole('viewer');
    const res = mockRes();
    requireRole('admin', 'operator')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user role matches exactly', () => {
    const req = reqWithRole('admin');
    const res = mockRes();
    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when user role is one of multiple allowed roles', () => {
    const req = reqWithRole('operator');
    const res = mockRes();
    requireRole('admin', 'operator')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
