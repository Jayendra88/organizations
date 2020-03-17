import React, { useState } from 'react'
import { useQuery, useMutation, useApolloClient } from 'react-apollo'
import { Button } from 'vtex.styleguide'
import { pathOr, find, propEq } from 'ramda'
import { injectIntl } from 'react-intl'

import { documentSerializer } from '../utils/documentSerializer'

import AddUser from './modals/AddUser'
import UserConfirmationModal from './modals/UserConfirmationModal'
import UserEditModal from './modals/UserEditModal'

import documentQuery from '../graphql/documents.graphql'
import DELETE_DOCUMENT from '../graphql/deleteDocument.graphql'
import UPDATE_DOCUMENT from '../graphql/updateDocument.graphql'
import UserListItem from './UserListItem'

import { updateCacheDeleteUser, updateCacheReInvite } from '../utils/cacheUtils'
import {
  CLIENT_ACRONYM,
  CLIENT_FIELDS,
  BUSINESS_ROLE,
  BUSINESS_ROLE_FIELDS,
  BUSINESS_ROLE_SCHEMA,
  ORG_ASSIGNMENT,
  ORG_ASSIGNMENT_FIELDS,
  ORG_ASSIGNMENT_SCHEMA,
  ASSIGNMENT_STATUS_APPROVED,
} from '../utils/const'
import { getErrorMessage } from '../utils/graphqlErrorHandler'

interface Props {
  isCurrentUserAdmin: boolean
  email: string
  organizationId: string
  showToast: (message: any) => void
  intl: any
}

const MyUsers = ({ isCurrentUserAdmin, organizationId, email, showToast, intl }: Props) => {
  const [updateDocument] = useMutation(UPDATE_DOCUMENT)
  const [deleteDocument] = useMutation(DELETE_DOCUMENT, {
    update: (cache: any, { data }: any) =>
      updateCacheDeleteUser(cache, data, organizationId),
  })

  const [isAddNewUserOpen, setIsAddNewUserOpen] = useState(false)

  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(
    false
  )

  const [deleteConfirmationLoading, setDeleteConfirmationLoading] = useState(
    false
  )

  const [sharedOrgAssignment, setSharedOrgAssignment] = useState(
    {} as OrganizationAssignment
  )

  const client = useApolloClient()

  const [isUserEditOpen, setIsUserEditOpen] = useState(false)

  const { data: roleData } = useQuery(documentQuery, {
    variables: {
      acronym: BUSINESS_ROLE,
      fields: BUSINESS_ROLE_FIELDS,
      schema: BUSINESS_ROLE_SCHEMA,
    },
  })
  const { data: orgAssignments } = useQuery(documentQuery, {
    skip: organizationId == '',
    variables: {
      acronym: ORG_ASSIGNMENT,
      fields: ORG_ASSIGNMENT_FIELDS,
      where: `businessOrganizationId=${organizationId}`,
      schema: ORG_ASSIGNMENT_SCHEMA,
    },
  })

  const rolesList: any[] = documentSerializer(
    pathOr([], ['myDocuments'], roleData)
  )
  const roles: Role[] = rolesList.map((role: any) => ({
    label: role.label,
    value: role.id,
    name: role.name,
  }))
  const assignments: OrganizationAssignment[] = documentSerializer(
    pathOr([], ['myDocuments'], orgAssignments)
  )

  const defaultUserAssignment: OrganizationAssignment = find(
    propEq('email', email),
    assignments
  ) as OrganizationAssignment

  const deleteOrgAssignment = (assignment: OrganizationAssignment) => {
    return deleteDocument({
      variables: {
        acronym: ORG_ASSIGNMENT,
        documentId: assignment.id,
      },
    })
  }

  // ** Delete Org Assignment
  // ** Remove `organizationId` from CL
  // ** Remove `isOrgAdmin` from CL
  const deleteAssignmentWithUser = (assignment: OrganizationAssignment) => {
    return deleteOrgAssignment(assignment)
      .then(() => {
        return client.query({
          query: documentQuery,
          variables: {
            acronym: CLIENT_ACRONYM,
            fields: CLIENT_FIELDS,
            where: `email=${assignment.email}`,
          },
        })
      })
      .then(({ data }: any) => {
        const clid = pathOr('', ['myDocuments', 0, 'id'], data)
        return updateDocument({
          variables: {
            acronym: CLIENT_ACRONYM,
            document: {
              fields: [
                { key: 'id', value: clid },
                { key: 'organizationId', value: '' },
                { key: 'isOrgAdmin', value: 'false' },
              ],
            },
          },
        })
      })
  }

  // Delete user - [Delete Btn clicked]
  const deleteUserAssignment = (assignmentId: string) => {
    const assignment = find(propEq('id', assignmentId), assignments)
    setSharedOrgAssignment(assignment as OrganizationAssignment)
    setIsDeleteConfirmationOpen(true)
  }

  // Confirm delete - [Confirm delete btn clicked]
  // ** delete org assignment with user if request is approved
  const confirmDelete = () => {
    setDeleteConfirmationLoading(true)
    const doDelete =
      sharedOrgAssignment.status === ASSIGNMENT_STATUS_APPROVED
        ? deleteAssignmentWithUser
        : deleteOrgAssignment
    doDelete(sharedOrgAssignment)
      .then(() => {
        setDeleteConfirmationLoading(false)
        setIsDeleteConfirmationOpen(false)
        setSharedOrgAssignment({} as OrganizationAssignment)
      })
      .catch((e: Error) => {
        const message = getErrorMessage(e)
        setDeleteConfirmationLoading(false)
        setIsDeleteConfirmationOpen(false)
        setSharedOrgAssignment({} as OrganizationAssignment)
        showToast({
          message: `${intl.formatMessage({
            id: 'store/my-users.toast.user.delete.error',
          })} ${message}`,
          duration: 5000,
          horizontalPosition: 'right',
        })
      })
  }

  // Close delete confirmation
  const closeDelete = () => {
    setIsDeleteConfirmationOpen(false)
    setSharedOrgAssignment({} as OrganizationAssignment)
  }

  // Re invite user - [Delete Btn clicked]
  // ** Get CL with email
  // ** Update his organization if he is not belongs to other company
  // ** Set organization assignment to APPROVED
  const reInvite = (assignmentId: string) => {
    const assignment = find(propEq('id', assignmentId), assignments) as any

    client
      .query({
        query: documentQuery,
        variables: {
          acronym: CLIENT_ACRONYM,
          fields: CLIENT_FIELDS,
          where: `email=${assignment.email}`,
        },
        fetchPolicy: 'no-cache',
      })
      .then(({ data }: any) => {
        const clients = documentSerializer(data ? data.myDocuments : [])

        const clientId_d = pathOr('', [0, 'id'], clients)
        const organizationId_d = pathOr('', [0, 'organizationId'], clients)

        if (organizationId_d !== '') {
          showToast({
            message: `This user is already belongs to some other company`,
            duration: 5000,
            horizontalPosition: 'right',
          })
          return Promise.reject()
        } else {
          return updateDocument({
            variables: {
              acronym: CLIENT_ACRONYM,
              document: {
                fields: [
                  { key: 'id', value: clientId_d },
                  { key: 'organizationId', value: organizationId },
                ],
              },
            },
          })
        }
      })
      .then(() => {
        return updateDocument({
          variables: {
            acronym: ORG_ASSIGNMENT,
            document: {
              fields: [
                { key: 'id', value: assignmentId },
                { key: 'status', value: ASSIGNMENT_STATUS_APPROVED },
              ],
            },
            schema: ORG_ASSIGNMENT_SCHEMA,
          },
          update: (cache: any, { data }: any) =>
            updateCacheReInvite(cache, data, organizationId),
        })
      })
      .then(() => {
        showToast({
          message: `${intl.formatMessage({
            id: 'store/my-users.toast.user.reinvitation.sent',
          })} `,
          duration: 5000,
          horizontalPosition: 'right',
        })
        setSharedOrgAssignment({} as OrganizationAssignment)
      })
      .catch((e: Error) => {
        const message = getErrorMessage(e)
        if (message && message !== '') {
          showToast({
            message: `${intl.formatMessage({
              id: 'store/my-users.toast.user.reinvitation.error',
            })} ${message}`,
            duration: 5000,
            horizontalPosition: 'right',
          })
        }
      })
  }

  // Edit organization assignment - [Edit Btn clicked]
  const editUser = (assignmentId: string) => {
    const assignment = find(propEq('id', assignmentId), assignments)
    setSharedOrgAssignment(assignment as OrganizationAssignment)
    setIsUserEditOpen(true)
  }

  // Close edit organization assignment 
  const closeUserEditModal = () => {
    setSharedOrgAssignment({} as OrganizationAssignment)
    setIsUserEditOpen(false)
  }

  // Create organization assignment - [New organization Btn clicked]
  const addNewUser = () => {
    setIsAddNewUserOpen(true)
  }

  // close modals org assignment create
  const closeModalAddNewUser = () => {
    setIsAddNewUserOpen(false)
  }

  return (
    <div className="flex flex-column pa5">
      <div className="flex-row">
        <div className="fl pr2">
          <h3>
            {intl.formatMessage({
              id: 'store/my-users.my-organization.users-in-organization',
            })}
          </h3>
        </div>
        <div className="fl pl3 mt5">
          <Button
            variation="secondary"
            size="small"
            onClick={() => addNewUser()}>
            {intl.formatMessage({
              id: 'store/my-users.my-user.table.button.add-new',
            })}
          </Button>
        </div>
      </div>
      <div className="flex flex-column">
        <div>
          <div className="mb5">
            {assignments.map((assignment: OrganizationAssignment) => {
              return (
                <UserListItem
                  isDefaultAssignment={
                    defaultUserAssignment.id == assignment.id
                  }
                  orgAssignment={assignment}
                  edit={editUser}
                  reInvite={reInvite}
                  deleteAssignment={deleteUserAssignment}
                />
              )
            })}
          </div>
        </div>
        <UserConfirmationModal
          isOpen={isDeleteConfirmationOpen}
          isLoading={deleteConfirmationLoading}
          onConfirm={confirmDelete}
          onClose={closeDelete}
          assignment={sharedOrgAssignment}
          confirmAction={intl.formatMessage({
            id: 'store/my-users.my-user.delete-confirmation-action',
          })}
          message={intl.formatMessage({
            id: 'store/my-users.my-user.delete-confirmation-message',
          })}
        />
        <UserEditModal
          isOpen={isUserEditOpen}
          onClose={closeUserEditModal}
          onSave={closeUserEditModal}
          orgAssignment={sharedOrgAssignment}
          roles={roles}
          showToast={showToast}
          isCurrentUserAdmin={isCurrentUserAdmin}
        />
        <AddUser
          roles={roles}
          organizationId={organizationId}
          isOpen={isAddNewUserOpen}
          onClose={closeModalAddNewUser}
          onSuccess={closeModalAddNewUser}
          showToast={showToast}
          isCurrentUserAdmin={isCurrentUserAdmin}
          existingUsers={assignments.map((assignment: OrganizationAssignment) =>
            pathOr('', ['personaId_linked', 'email'], assignment)
          )}
        />
      </div>
    </div>
  )
}

export default injectIntl(MyUsers)
